import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageTasks, isAdmin } from '@/lib/permissions'
import { checkTaskMgmtRateLimit } from '@/lib/ratelimit'
import {
  validateTitle,
  validateDescription,
  validateTaskType,
  validateOrder,
  validateCuid,
} from '@/lib/validation'
import { log } from '@/lib/logger'
import { verifyActiveSession } from '@/lib/session'
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

  if (!await verifyActiveSession(session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { taskId } = params
  const taskIdErr = validateCuid(taskId, 'taskId')
  if (taskIdErr) return NextResponse.json({ error: taskIdErr }, { status: 400 })

  const task = await prisma.onboardingTask.findUnique({
    where: { id: taskId },
    include: {
      resourceDocument: { select: { id: true, filename: true } },
      course: { select: { id: true, title: true } },
    },
  })
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  return NextResponse.json(task)
}

// PUT /api/tasks/[taskId] — update a task definition (HR+ only)
// Tasks no longer have assignedRole; role assignment is handled via workflows.
export async function PUT(req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!canManageTasks(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!await verifyActiveSession(session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await checkTaskMgmtRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  const { taskId } = params
  const taskIdErr = validateCuid(taskId, 'taskId')
  if (taskIdErr) return NextResponse.json({ error: taskIdErr }, { status: 400 })

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

  const { title, description, taskType, order, resourceDocumentId, courseId } = body as Record<string, unknown>

  if (
    title === undefined &&
    description === undefined &&
    taskType === undefined &&
    order === undefined &&
    !('resourceDocumentId' in (body as object)) &&
    !('courseId' in (body as object))
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

  // Resolve the effective task type for cross-field validation
  const effectiveType = (taskType ?? existing.taskType) as TaskType

  let resolvedResourceDocumentId: string | null | undefined = undefined
  if ('resourceDocumentId' in (body as object)) {
    if (resourceDocumentId === null) {
      resolvedResourceDocumentId = null
    } else {
      const cuidErr = validateCuid(resourceDocumentId, 'resourceDocumentId')
      if (cuidErr) return NextResponse.json({ error: cuidErr }, { status: 400 })

      const resourceDoc = await prisma.document.findUnique({
        where: { id: resourceDocumentId as string },
        select: { isResource: true },
      })
      if (!resourceDoc || !resourceDoc.isResource) {
        return NextResponse.json({ error: 'resourceDocumentId must reference an existing Resource document' }, { status: 400 })
      }
      resolvedResourceDocumentId = resourceDocumentId as string
    }
  }

  let resolvedCourseId: string | null | undefined = undefined
  if ('courseId' in (body as object)) {
    if (courseId === null) {
      resolvedCourseId = null
    } else {
      if (effectiveType !== 'LEARNING') {
        return NextResponse.json({ error: 'courseId is only valid for LEARNING tasks' }, { status: 400 })
      }
      const cuidErr = validateCuid(courseId, 'courseId')
      if (cuidErr) return NextResponse.json({ error: cuidErr }, { status: 400 })

      const course = await prisma.course.findUnique({
        where: { id: courseId as string },
        select: { id: true },
      })
      if (!course) {
        return NextResponse.json({ error: 'courseId must reference an existing course' }, { status: 400 })
      }
      resolvedCourseId = courseId as string
    }
  }

  const task = await prisma.onboardingTask.update({
    where: { id: taskId },
    data: {
      ...(title !== undefined && { title: (title as string).trim() }),
      ...(description !== undefined && {
        description: typeof description === 'string' ? description.trim() : null,
      }),
      ...(taskType !== undefined && { taskType: taskType as TaskType }),
      ...(order !== undefined && { order: validateOrder(order) }),
      ...(resolvedResourceDocumentId !== undefined && { resourceDocumentId: resolvedResourceDocumentId }),
      ...(resolvedCourseId !== undefined && { courseId: resolvedCourseId }),
    },
    include: {
      resourceDocument: { select: { id: true, filename: true } },
      course: { select: { id: true, title: true } },
    },
  })

  log({ message: 'task updated', action: 'task_update', userId: session.user.id, statusCode: 200, meta: { taskId: task.id } })
  return NextResponse.json(task)
}

// DELETE /api/tasks/[taskId] — delete a task definition (ADMIN only)
// Blocked if any UserTask records or WorkflowTask memberships reference this task.
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
    await checkTaskMgmtRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  const { taskId } = params
  const taskIdErr = validateCuid(taskId, 'taskId')
  if (taskIdErr) return NextResponse.json({ error: taskIdErr }, { status: 400 })

  const existing = await prisma.onboardingTask.findUnique({
    where: { id: taskId },
    select: { id: true, _count: { select: { userTasks: true, workflowTasks: true } } },
  })

  if (!existing) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  if (existing._count.userTasks > 0) {
    return NextResponse.json(
      { error: 'Cannot delete a task that has completion records.' },
      { status: 409 },
    )
  }

  if (existing._count.workflowTasks > 0) {
    return NextResponse.json(
      { error: 'Cannot delete a task that belongs to a workflow. Remove it from all workflows first.' },
      { status: 409 },
    )
  }

  await prisma.onboardingTask.delete({ where: { id: taskId } })

  log({ message: 'task deleted', action: 'task_delete', userId: session.user.id, statusCode: 200, meta: { taskId } })
  return NextResponse.json({ deleted: true })
}
