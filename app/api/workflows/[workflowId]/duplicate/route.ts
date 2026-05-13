import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageWorkflows } from '@/lib/permissions'
import { checkWorkflowMgmtRateLimit } from '@/lib/ratelimit'
import { verifyActiveSession } from '@/lib/session'
import { log } from '@/lib/logger'
import type { Role } from '@prisma/client'

const MAX_NAME_LEN = 128
const COPY_PREFIX = 'Copy of '
const MAX_SUFFIX_LEN = ' (10)'.length

interface RouteContext {
  params: Promise<{ workflowId: string }>
}

function buildCandidateName(sourceName: string, n: number): string {
  if (n === 1) {
    return (COPY_PREFIX + sourceName).slice(0, MAX_NAME_LEN)
  }
  const suffix = ` (${n})`
  const base = (COPY_PREFIX + sourceName).slice(0, MAX_NAME_LEN - MAX_SUFFIX_LEN)
  return (base + suffix).slice(0, MAX_NAME_LEN)
}

// POST /api/workflows/[workflowId]/duplicate — duplicate a workflow template (HR+ only)
export async function POST(_req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!canManageWorkflows(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!await verifyActiveSession(session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await checkWorkflowMgmtRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  const { workflowId } = await params

  const source = await prisma.workflow.findUnique({
    where: { id: workflowId },
    include: {
      tasks: { orderBy: { order: 'asc' } },
    },
  })

  if (!source) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  let uniqueName: string | null = null
  for (let n = 1; n <= 10; n++) {
    const candidate = buildCandidateName(source.name, n)
    const conflict = await prisma.workflow.findUnique({ where: { name: candidate } })
    if (!conflict) {
      uniqueName = candidate
      break
    }
  }

  if (!uniqueName) {
    return NextResponse.json(
      { error: 'Could not generate a unique name for the duplicate. Rename the original workflow first.' },
      { status: 409 },
    )
  }

  const [newWorkflow] = await prisma.$transaction(async (tx) => {
    const created = await tx.workflow.create({
      data: {
        name: uniqueName as string,
        description: source.description,
      },
    })

    if (source.tasks.length > 0) {
      await tx.workflowTask.createMany({
        data: source.tasks.map((t) => ({
          workflowId: created.id,
          taskId: t.taskId,
          order: t.order,
        })),
      })
    }

    return [created]
  })

  const newWorkflowWithTasks = await prisma.workflow.findUnique({
    where: { id: newWorkflow.id },
    include: {
      tasks: {
        include: { task: true },
        orderBy: { order: 'asc' },
      },
    },
  })

  log({
    message: 'workflow duplicated',
    action: 'workflow_duplicate',
    userId: session.user.id,
    statusCode: 201,
    meta: { sourceWorkflowId: workflowId, newWorkflowId: newWorkflow.id },
  })

  return NextResponse.json(newWorkflowWithTasks, { status: 201 })
}
