import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageWorkflows } from '@/lib/permissions'
import { checkWorkflowMgmtRateLimit } from '@/lib/ratelimit'
import { verifyActiveSession } from '@/lib/session'
import { validateWorkflowName, validateDescription, validatePageParam, validateLimitParam } from '@/lib/validation'
import { log } from '@/lib/logger'
import type { Role } from '@prisma/client'

const MAX_LIMIT = 100

// GET /api/workflows — list all workflows with task count (HR+ only)
export async function GET(req: NextRequest) {
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

  const { searchParams } = req.nextUrl
  const pageResult = validatePageParam(searchParams.get('page') ?? undefined)
  if ('error' in pageResult) return NextResponse.json({ error: pageResult.error }, { status: 400 })
  const limitResult = validateLimitParam(searchParams.get('limit') ?? undefined, MAX_LIMIT)
  if ('error' in limitResult) return NextResponse.json({ error: limitResult.error }, { status: 400 })

  const page = pageResult.value
  const limit = limitResult.value

  const [workflows, total] = await Promise.all([
    prisma.workflow.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { tasks: true, userWorkflows: true } },
      },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.workflow.count(),
  ])

  return NextResponse.json({ workflows, total, page, totalPages: Math.ceil(total / limit) })
}

// POST /api/workflows — create a workflow (HR+ only)
export async function POST(req: NextRequest) {
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

  const nameErr = validateWorkflowName(name)
  if (nameErr) return NextResponse.json({ error: nameErr }, { status: 400 })

  const descErr = validateDescription(description)
  if (descErr) return NextResponse.json({ error: descErr }, { status: 400 })

  const existing = await prisma.workflow.findUnique({ where: { name: (name as string).trim() } })
  if (existing) {
    return NextResponse.json({ error: 'A workflow with this name already exists' }, { status: 409 })
  }

  const workflow = await prisma.workflow.create({
    data: {
      name: (name as string).trim(),
      description: typeof description === 'string' ? description.trim() : null,
    },
  })

  log({ message: 'workflow created', action: 'workflow_create', userId: session.user.id, statusCode: 201, meta: { workflowId: workflow.id } })
  return NextResponse.json(workflow, { status: 201 })
}
