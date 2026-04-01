import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageWorkflows } from '@/lib/permissions'
import { checkWorkflowMgmtRateLimit } from '@/lib/ratelimit'
import { verifyActiveSession } from '@/lib/session'
import { validateOrder } from '@/lib/validation'
import type { Role } from '@prisma/client'
import { notifyTaskAddedToWorkflow } from '@/lib/email'

interface RouteContext {
  params: { workflowId: string }
}

// POST /api/workflows/[workflowId]/tasks — add a task to this workflow (HR+ only)
export async function POST(req: NextRequest, { params }: RouteContext) {
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

  const workflow = await prisma.workflow.findUnique({ where: { id: params.workflowId } })
  if (!workflow) {
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

  const { taskId, order } = body as Record<string, unknown>

  if (typeof taskId !== 'string' || taskId.length === 0) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
  }

  const task = await prisma.onboardingTask.findUnique({ where: { id: taskId } })
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const existing = await prisma.workflowTask.findUnique({
    where: { workflowId_taskId: { workflowId: params.workflowId, taskId } },
  })
  if (existing) {
    return NextResponse.json({ error: 'Task already belongs to this workflow' }, { status: 409 })
  }

  const workflowTask = await prisma.workflowTask.create({
    data: {
      workflowId: params.workflowId,
      taskId,
      order: validateOrder(order),
    },
    include: { task: true },
  })

  void notifyTaskAddedToWorkflow(params.workflowId, taskId)
  return NextResponse.json(workflowTask, { status: 201 })
}

// DELETE /api/workflows/[workflowId]/tasks — remove a task from this workflow (HR+ only)
// Blocked if any enrolled users have completion records for this task.
export async function DELETE(req: NextRequest, { params }: RouteContext) {
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

  const { taskId } = body as Record<string, unknown>

  if (typeof taskId !== 'string' || taskId.length === 0) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
  }

  const wfTask = await prisma.workflowTask.findUnique({
    where: { workflowId_taskId: { workflowId: params.workflowId, taskId } },
  })
  if (!wfTask) {
    return NextResponse.json({ error: 'Task not found in this workflow' }, { status: 404 })
  }

  // Block removal if any enrolled user has a completion record for this task
  const enrolledUserIds = await prisma.userWorkflow.findMany({
    where: { workflowId: params.workflowId },
    select: { userId: true },
  })

  const completedCount = await prisma.userTask.count({
    where: {
      taskId,
      userId: { in: enrolledUserIds.map((u) => u.userId) },
      completed: true,
    },
  })

  if (completedCount > 0) {
    return NextResponse.json(
      { error: 'Cannot remove a task that enrolled users have already completed.' },
      { status: 409 },
    )
  }

  await prisma.workflowTask.delete({
    where: { workflowId_taskId: { workflowId: params.workflowId, taskId } },
  })

  return NextResponse.json({ deleted: true })
}
