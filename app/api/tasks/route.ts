import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageTasks } from '@/lib/permissions'
import { checkTaskMgmtRateLimit } from '@/lib/ratelimit'
import {
  validateTitle,
  validateDescription,
  validateTaskType,
  validateOrder,
  validateCuid,
} from '@/lib/validation'
import type { Role, TaskType } from '@prisma/client'

// GET /api/tasks — list all onboarding task definitions (HR+ only)
export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!canManageTasks(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const tasks = await prisma.onboardingTask.findMany({
    orderBy: { order: 'asc' },
    include: {
      resourceDocument: { select: { id: true, filename: true } },
    },
  })

  return NextResponse.json(tasks)
}

// POST /api/tasks — create a task definition (HR+ only)
// Tasks are no longer role-assigned; they are added to workflows instead.
export async function POST(req: NextRequest) {
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

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { title, description, taskType, order, resourceDocumentId } = body as Record<string, unknown>

  const titleErr = validateTitle(title)
  if (titleErr) return NextResponse.json({ error: titleErr }, { status: 400 })

  const descErr = validateDescription(description)
  if (descErr) return NextResponse.json({ error: descErr }, { status: 400 })

  const typeErr = validateTaskType(taskType)
  if (typeErr) return NextResponse.json({ error: typeErr }, { status: 400 })

  let resolvedResourceDocumentId: string | null = null
  if (resourceDocumentId != null) {
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

  const task = await prisma.onboardingTask.create({
    data: {
      title: (title as string).trim(),
      description: typeof description === 'string' ? description.trim() : null,
      taskType: (taskType as TaskType | undefined) ?? 'STANDARD',
      order: validateOrder(order),
      resourceDocumentId: resolvedResourceDocumentId,
    },
    include: {
      resourceDocument: { select: { id: true, filename: true } },
    },
  })

  return NextResponse.json(task, { status: 201 })
}

// PATCH /api/tasks — mark a STANDARD task complete/incomplete for the authenticated user.
// Authorization: user must have this task via a workflow assignment.
// UPLOAD tasks are completed exclusively via POST /api/tasks/[taskId]/upload.
export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

  const { userId, taskId, completed } = body as Record<string, unknown>

  if (typeof userId !== 'string' || typeof taskId !== 'string' || typeof completed !== 'boolean') {
    return NextResponse.json(
      { error: 'userId, taskId, and completed are required' },
      { status: 400 },
    )
  }

  // Object-level check: users can only update their own task records
  if (userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Verify task exists and is STANDARD type
  const task = await prisma.onboardingTask.findUnique({
    where: { id: taskId },
    select: { taskType: true },
  })

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  // UPLOAD tasks are completed via file upload only — not by checkbox
  if (task.taskType === 'UPLOAD') {
    return NextResponse.json(
      { error: 'UPLOAD tasks must be completed by uploading a file' },
      { status: 409 },
    )
  }

  // Workflow membership check: user must have this task via at least one workflow assignment
  const membership = await prisma.workflowTask.findFirst({
    where: {
      taskId,
      workflow: {
        userWorkflows: {
          some: { userId: session.user.id },
        },
      },
    },
  })

  if (!membership) {
    return NextResponse.json({ error: 'Task not assigned to you' }, { status: 403 })
  }

  const userTask = await prisma.userTask.upsert({
    where: { userId_taskId: { userId, taskId } },
    update: {
      completed,
      completedAt: completed ? new Date() : null,
      // Un-completing resets approval status
      approvalStatus: completed ? undefined : 'PENDING',
      approvedAt: completed ? undefined : null,
      approvedById: completed ? undefined : null,
    },
    create: {
      userId,
      taskId,
      completed,
      completedAt: completed ? new Date() : null,
    },
  })

  return NextResponse.json(userTask)
}
