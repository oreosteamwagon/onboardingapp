import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canAssignWorkflows, isAdmin } from '@/lib/permissions'
import { checkWorkflowMgmtRateLimit } from '@/lib/ratelimit'
import type { Role } from '@prisma/client'

interface RouteContext {
  params: { userId: string; workflowId: string }
}

// PATCH /api/users/[userId]/workflows/[workflowId] — update the assigned supervisor (HR+ only)
export async function PATCH(req: NextRequest, { params }: RouteContext) {
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

  const assignment = await prisma.userWorkflow.findUnique({
    where: { userId_workflowId: { userId: params.userId, workflowId: params.workflowId } },
  })
  if (!assignment) {
    return NextResponse.json({ error: 'Workflow assignment not found' }, { status: 404 })
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

  // supervisorId may be null (to clear it) or a string referencing an active SUPERVISOR
  const { supervisorId } = body as Record<string, unknown>

  if (supervisorId !== undefined && supervisorId !== null) {
    if (typeof supervisorId !== 'string' || supervisorId.length === 0) {
      return NextResponse.json({ error: 'supervisorId must be a non-empty string or null' }, { status: 400 })
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

  const updated = await prisma.userWorkflow.update({
    where: { userId_workflowId: { userId: params.userId, workflowId: params.workflowId } },
    data: { supervisorId: supervisorId === null ? null : (supervisorId as string | undefined) },
  })

  return NextResponse.json(updated)
}

// DELETE /api/users/[userId]/workflows/[workflowId] — unassign a workflow (ADMIN only)
// Blocked if any tasks in the workflow have been completed or approved.
// Pass ?force=true (ADMIN only) to override and remove all UserTask records.
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isAdmin(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await checkWorkflowMgmtRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const assignment = await prisma.userWorkflow.findUnique({
    where: { userId_workflowId: { userId: params.userId, workflowId: params.workflowId } },
    include: { workflow: { include: { tasks: { select: { taskId: true } } } } },
  })
  if (!assignment) {
    return NextResponse.json({ error: 'Workflow assignment not found' }, { status: 404 })
  }

  const url = new URL(req.url)
  const force = url.searchParams.get('force') === 'true'

  const taskIds = assignment.workflow.tasks.map((t) => t.taskId)

  const completedCount = await prisma.userTask.count({
    where: {
      userId: params.userId,
      taskId: { in: taskIds },
      completed: true,
    },
  })

  if (completedCount > 0 && !force) {
    return NextResponse.json(
      {
        error: `${completedCount} task(s) have been completed. Use ?force=true to remove the assignment and all completion records.`,
      },
      { status: 409 },
    )
  }

  await prisma.$transaction(async (tx) => {
    // With force: delete UserTask records for this workflow's tasks
    if (force && taskIds.length > 0) {
      // First clear documentId FKs (which have @unique) to allow UserTask deletion
      await tx.userTask.updateMany({
        where: { userId: params.userId, taskId: { in: taskIds } },
        data: { documentId: null },
      })
      await tx.userTask.deleteMany({
        where: { userId: params.userId, taskId: { in: taskIds } },
      })
    }
    await tx.userWorkflow.delete({
      where: { userId_workflowId: { userId: params.userId, workflowId: params.workflowId } },
    })
  })

  return NextResponse.json({ deleted: true })
}
