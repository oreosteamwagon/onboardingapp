import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageWorkflows, isAdmin } from '@/lib/permissions'
import { checkWorkflowMgmtRateLimit } from '@/lib/ratelimit'
import { verifyActiveSession } from '@/lib/session'
import { validateWorkflowName, validateDescription } from '@/lib/validation'
import { log } from '@/lib/logger'
import type { Role } from '@prisma/client'

interface RouteContext {
  params: { workflowId: string }
}

// GET /api/workflows/[workflowId] — fetch workflow with its tasks (HR+ only)
export async function GET(_req: NextRequest, { params }: RouteContext) {
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

  const workflow = await prisma.workflow.findUnique({
    where: { id: params.workflowId },
    include: {
      tasks: {
        include: { task: true },
        orderBy: { order: 'asc' },
      },
    },
  })

  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  return NextResponse.json(workflow)
}

// PUT /api/workflows/[workflowId] — update workflow name/description (HR+ only)
export async function PUT(req: NextRequest, { params }: RouteContext) {
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
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const existing = await prisma.workflow.findUnique({ where: { id: params.workflowId } })
  if (!existing) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { name, description } = body as Record<string, unknown>

  if (name === undefined && description === undefined) {
    return NextResponse.json({ error: 'No fields provided to update' }, { status: 400 })
  }

  if (name !== undefined) {
    const err = validateWorkflowName(name)
    if (err) return NextResponse.json({ error: err }, { status: 400 })

    const dupe = await prisma.workflow.findFirst({
      where: { name: (name as string).trim(), id: { not: params.workflowId } },
    })
    if (dupe) {
      return NextResponse.json({ error: 'A workflow with this name already exists' }, { status: 409 })
    }
  }

  if (description !== undefined) {
    const err = validateDescription(description)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
  }

  const workflow = await prisma.workflow.update({
    where: { id: params.workflowId },
    data: {
      ...(name !== undefined && { name: (name as string).trim() }),
      ...(description !== undefined && {
        description: typeof description === 'string' ? description.trim() : null,
      }),
    },
  })

  log({ message: 'workflow updated', action: 'workflow_update', userId: session.user.id, statusCode: 200, meta: { workflowId: workflow.id } })
  return NextResponse.json(workflow)
}

// DELETE /api/workflows/[workflowId] — delete a workflow (ADMIN only)
// Blocked if any users are assigned to it.
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isAdmin(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!await verifyActiveSession(session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await checkWorkflowMgmtRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const existing = await prisma.workflow.findUnique({
    where: { id: params.workflowId },
    select: { id: true, _count: { select: { userWorkflows: true } } },
  })

  if (!existing) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  if (existing._count.userWorkflows > 0) {
    return NextResponse.json(
      { error: 'Cannot delete a workflow that is assigned to users. Unassign all users first.' },
      { status: 409 },
    )
  }

  // Remove all WorkflowTask memberships first, then delete the workflow
  await prisma.$transaction([
    prisma.workflowTask.deleteMany({ where: { workflowId: params.workflowId } }),
    prisma.workflow.delete({ where: { id: params.workflowId } }),
  ])

  log({ message: 'workflow deleted', action: 'workflow_delete', userId: session.user.id, statusCode: 200, meta: { workflowId: params.workflowId } })
  return NextResponse.json({ deleted: true })
}
