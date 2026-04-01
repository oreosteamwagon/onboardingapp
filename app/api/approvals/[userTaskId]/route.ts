import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canApprove, canApproveAny } from '@/lib/permissions'
import { checkApprovalRateLimit } from '@/lib/ratelimit'
import { verifyActiveSession } from '@/lib/session'
import { validateApprovalAction } from '@/lib/validation'
import type { Role, ApprovalStatus } from '@prisma/client'
import { checkAndNotifyWorkflowCompletion } from '@/lib/email'

interface RouteContext {
  params: { userTaskId: string }
}

// POST /api/approvals/[userTaskId] — approve or reject a completed task
// Body: { action: "APPROVED" | "REJECTED" }
// Admin/Payroll/HR: any task; Supervisor: only tasks in their supervised workflows
export async function POST(req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const role = session.user.role as Role

  if (!canApprove(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!await verifyActiveSession(session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await checkApprovalRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  // Fetch the task to be approved
  const userTask = await prisma.userTask.findUnique({
    where: { id: params.userTaskId },
    select: {
      id: true,
      userId: true,
      taskId: true,
      completed: true,
      approvalStatus: true,
    },
  })

  if (!userTask) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  if (!userTask.completed) {
    return NextResponse.json({ error: 'Task has not been completed by the user yet' }, { status: 409 })
  }

  if (userTask.approvalStatus !== 'PENDING') {
    return NextResponse.json(
      { error: `Task has already been ${userTask.approvalStatus.toLowerCase()}` },
      { status: 409 },
    )
  }

  // Supervisor scope enforcement — must join through WorkflowTask to prevent
  // cross-workflow scope creep (e.g., a supervisor approving tasks that belong
  // to workflows they do not supervise for this specific user)
  if (!canApproveAny(role)) {
    const scopedWorkflow = await prisma.userWorkflow.findFirst({
      where: {
        supervisorId: session.user.id,
        userId: userTask.userId,
        workflow: {
          tasks: { some: { taskId: userTask.taskId } },
        },
      },
      select: { id: true },
    })

    if (!scopedWorkflow) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Parse and validate request body
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { action } = body as Record<string, unknown>

  const actionErr = validateApprovalAction(action)
  if (actionErr) {
    return NextResponse.json({ error: actionErr }, { status: 400 })
  }

  // TOCTOU-safe: re-read approvalStatus inside the transaction before updating.
  // If two approvers attempt simultaneously, one will find status !== PENDING and abort.
  let updated: Awaited<ReturnType<typeof prisma.userTask.update>>

  try {
    updated = await prisma.$transaction(async (tx) => {
      const current = await tx.userTask.findUnique({
        where: { id: params.userTaskId },
        select: { approvalStatus: true },
      })

      if (!current || current.approvalStatus !== 'PENDING') {
        throw Object.assign(new Error('ALREADY_PROCESSED'), { code: 'ALREADY_PROCESSED' })
      }

      return tx.userTask.update({
        where: { id: params.userTaskId },
        data: {
          approvalStatus: action as ApprovalStatus,
          approvedAt: new Date(),
          approvedById: session.user.id,
        },
      })
    })
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ALREADY_PROCESSED') {
      return NextResponse.json({ error: 'Task has already been processed by another approver' }, { status: 409 })
    }
    throw err
  }

  if (action === 'APPROVED') {
    void checkAndNotifyWorkflowCompletion(userTask.userId, userTask.taskId)
  }

  return NextResponse.json(updated)
}
