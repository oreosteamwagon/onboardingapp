import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageTasks, isAdmin } from '@/lib/permissions'
import { checkTaskMgmtRateLimit } from '@/lib/ratelimit'
import {
  validateTitle,
  validateDescription,
  validateAssignedRole,
  validateTaskType,
  validateOrder,
} from '@/lib/validation'
import type { Role, TaskType } from '@prisma/client'

interface RouteContext {
  params: { taskId: string }
}

// GET /api/tasks/[taskId] — fetch a single task definition (HR+ only)
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!canManageTasks(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { taskId } = params
  if (typeof taskId !== 'string' || taskId.length === 0) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
  }

  const task = await prisma.onboardingTask.findUnique({ where: { id: taskId } })
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  return NextResponse.json(task)
}

// PUT /api/tasks/[taskId] — update a task definition (HR+ only)
export async function PUT(req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!canManageTasks(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await checkTaskMgmtRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { taskId } = params
  if (typeof taskId !== 'string' || taskId.length === 0) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
  }

  const existing = await prisma.onboardingTask.findUnique({ where: { id: taskId } })
  if (!existing) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
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

  const { title, description, taskType, assignedRole, order } = body as Record<string, unknown>

  // At least one field must be provided
  if (
    title === undefined &&
    description === undefined &&
    taskType === undefined &&
    assignedRole === undefined &&
    order === undefined
  ) {
    return NextResponse.json({ error: 'No fields provided to update' }, { status: 400 })
  }

  if (title !== undefined) {
    const err = validateTitle(title)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
  }

  if (description !== undefined) {
    const err = validateDescription(description)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
  }

  if (taskType !== undefined) {
    const err = validateTaskType(taskType)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
  }

  if (assignedRole !== undefined) {
    const err = validateAssignedRole(assignedRole)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
  }

  const task = await prisma.onboardingTask.update({
    where: { id: taskId },
    data: {
      ...(title !== undefined && { title: (title as string).trim() }),
      ...(description !== undefined && {
        description: typeof description === 'string' ? description.trim() : null,
      }),
      ...(taskType !== undefined && { taskType: taskType as TaskType }),
      ...(assignedRole !== undefined && { assignedRole: assignedRole as Role[] }),
      ...(order !== undefined && { order: validateOrder(order) }),
    },
  })

  return NextResponse.json(task)
}

// DELETE /api/tasks/[taskId] — delete a task definition (ADMIN only)
// Blocked if any UserTask records reference this task to prevent loss of completion history.
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isAdmin(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await checkTaskMgmtRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { taskId } = params
  if (typeof taskId !== 'string' || taskId.length === 0) {
    return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
  }

  const existing = await prisma.onboardingTask.findUnique({
    where: { id: taskId },
    select: { id: true, _count: { select: { userTasks: true } } },
  })

  if (!existing) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  if (existing._count.userTasks > 0) {
    return NextResponse.json(
      {
        error:
          'Cannot delete a task that has completion records. Deactivate or reassign users first.',
      },
      { status: 409 },
    )
  }

  await prisma.onboardingTask.delete({ where: { id: taskId } })

  return NextResponse.json({ deleted: true })
}
