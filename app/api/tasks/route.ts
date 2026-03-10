import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageTasks } from '@/lib/permissions'
import type { Role } from '@prisma/client'

const VALID_ROLES: Role[] = ['USER', 'PAYROLL', 'HR', 'SUPERVISOR', 'ADMIN']

// GET /api/tasks — list all onboarding tasks (HR+ only)
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
  })

  return NextResponse.json(tasks)
}

// POST /api/tasks — create a task (HR+ only)
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!canManageTasks(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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

  const { title, description, assignedRole, order } = body as Record<string, unknown>

  if (typeof title !== 'string' || title.trim().length === 0 || title.length > 256) {
    return NextResponse.json({ error: 'title is required (max 256 chars)' }, { status: 400 })
  }

  if (description !== undefined && (typeof description !== 'string' || description.length > 2000)) {
    return NextResponse.json({ error: 'description must be a string (max 2000 chars)' }, { status: 400 })
  }

  if (!Array.isArray(assignedRole) || assignedRole.length === 0) {
    return NextResponse.json({ error: 'assignedRole must be a non-empty array of roles' }, { status: 400 })
  }

  for (const r of assignedRole) {
    if (!VALID_ROLES.includes(r as Role)) {
      return NextResponse.json({ error: `Invalid role: ${String(r)}` }, { status: 400 })
    }
  }

  const task = await prisma.onboardingTask.create({
    data: {
      title: title.trim(),
      description: typeof description === 'string' ? description.trim() : null,
      assignedRole: assignedRole as Role[],
      order: typeof order === 'number' ? Math.floor(order) : 0,
    },
  })

  return NextResponse.json(task, { status: 201 })
}

// PATCH /api/tasks — mark a task complete/incomplete for a user
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
    return NextResponse.json({ error: 'userId, taskId, and completed are required' }, { status: 400 })
  }

  // Users can only update their own tasks
  if (userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Verify task is assigned to user's role
  const task = await prisma.onboardingTask.findUnique({
    where: { id: taskId },
    select: { assignedRole: true },
  })

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  if (!task.assignedRole.includes(session.user.role as Role)) {
    return NextResponse.json({ error: 'Task not assigned to your role' }, { status: 403 })
  }

  const userTask = await prisma.userTask.upsert({
    where: { userId_taskId: { userId, taskId } },
    update: {
      completed,
      completedAt: completed ? new Date() : null,
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
