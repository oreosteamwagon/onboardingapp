import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canAssignWorkflows } from '@/lib/permissions'
import { checkWorkflowMgmtRateLimit } from '@/lib/ratelimit'
import type { Role } from '@prisma/client'

interface RouteContext {
  params: { userId: string }
}

// GET /api/users/[userId]/workflows — list workflow assignments for a user (HR+ or self)
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const isSelf = session.user.id === params.userId
  if (!isSelf && !canAssignWorkflows(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const assignments = await prisma.userWorkflow.findMany({
    where: { userId: params.userId },
    include: {
      workflow: {
        include: { tasks: { include: { task: true }, orderBy: { order: 'asc' } } },
      },
      supervisor: { select: { id: true, username: true } },
      assignedBy: { select: { id: true, username: true } },
    },
    orderBy: { assignedAt: 'asc' },
  })

  return NextResponse.json(assignments)
}

// POST /api/users/[userId]/workflows — assign a workflow to a user (HR+ only)
// Atomically creates the UserWorkflow and all UserTask records in a single transaction.
export async function POST(req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!canAssignWorkflows(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await checkWorkflowMgmtRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // Verify the target user exists and is active
  const targetUser = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, active: true },
  })
  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }
  if (!targetUser.active) {
    return NextResponse.json({ error: 'Cannot assign a workflow to an inactive user' }, { status: 409 })
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

  const { workflowId, supervisorId } = body as Record<string, unknown>

  if (typeof workflowId !== 'string' || workflowId.length === 0) {
    return NextResponse.json({ error: 'workflowId is required' }, { status: 400 })
  }

  // Verify workflow exists and fetch its tasks
  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
    include: { tasks: { select: { taskId: true } } },
  })
  if (!workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }

  // Validate optional supervisorId — must be a real active SUPERVISOR
  if (supervisorId !== undefined && supervisorId !== null) {
    if (typeof supervisorId !== 'string' || supervisorId.length === 0) {
      return NextResponse.json({ error: 'supervisorId must be a non-empty string' }, { status: 400 })
    }
    const supervisor = await prisma.user.findUnique({
      where: { id: supervisorId },
      select: { id: true, role: true, active: true },
    })
    if (!supervisor || supervisor.role !== 'SUPERVISOR' || !supervisor.active) {
      return NextResponse.json(
        { error: 'supervisorId must reference an active SUPERVISOR user' },
        { status: 400 },
      )
    }
  }

  // Check for duplicate assignment
  const alreadyAssigned = await prisma.userWorkflow.findUnique({
    where: { userId_workflowId: { userId: params.userId, workflowId } },
  })
  if (alreadyAssigned) {
    return NextResponse.json(
      { error: 'This workflow is already assigned to this user' },
      { status: 409 },
    )
  }

  // Atomic transaction: create UserWorkflow + create UserTask for each workflow task
  const result = await prisma.$transaction(async (tx) => {
    const userWorkflow = await tx.userWorkflow.create({
      data: {
        userId: params.userId,
        workflowId,
        supervisorId: typeof supervisorId === 'string' ? supervisorId : null,
        assignedById: session.user.id,
      },
    })

    // Bulk-create UserTask rows, skipping tasks that already have a record
    const existingTasks = await tx.userTask.findMany({
      where: {
        userId: params.userId,
        taskId: { in: workflow.tasks.map((t) => t.taskId) },
      },
      select: { taskId: true },
    })
    const existingTaskIds = new Set(existingTasks.map((t) => t.taskId))
    const newTaskIds = workflow.tasks
      .map((t) => t.taskId)
      .filter((id) => !existingTaskIds.has(id))

    if (newTaskIds.length > 0) {
      await tx.userTask.createMany({
        data: newTaskIds.map((taskId) => ({ userId: params.userId, taskId })),
      })
    }

    return userWorkflow
  })

  return NextResponse.json(result, { status: 201 })
}
