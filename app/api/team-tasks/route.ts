import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canApprove, canApproveAny } from '@/lib/permissions'
import { checkTeamTasksRateLimit } from '@/lib/ratelimit'
import { verifyActiveSession } from '@/lib/session'
import type { Role } from '@prisma/client'

export type WorkflowProgress = {
  userWorkflowId: string
  workflowId: string
  workflowName: string
  totalTasks: number
  completedTasks: number
  completionPct: number
  pendingApprovalCount: number
}

export type UserProgress = {
  userId: string
  username: string
  workflows: WorkflowProgress[]
}

// GET /api/team-tasks
// ADMIN/PAYROLL/HR: all users with any workflow assignment
// SUPERVISOR: only users in workflows where supervisorId = this user
export async function GET() {
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
    await checkTeamTasksRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const whereClause = canApproveAny(role)
    ? {} // Admin/Payroll/HR: all assignments
    : { supervisorId: session.user.id } // Supervisor: scoped to their workflows

  const assignments = await prisma.userWorkflow.findMany({
    where: whereClause,
    include: {
      user: { select: { id: true, username: true } },
      workflow: {
        select: {
          id: true,
          name: true,
          tasks: { select: { taskId: true } },
        },
      },
    },
    orderBy: [{ user: { username: 'asc' } }, { assignedAt: 'asc' }],
  })

  if (assignments.length === 0) {
    return NextResponse.json([])
  }

  // Batch-fetch all relevant UserTasks in a single query to avoid N+1
  const userIds = Array.from(new Set(assignments.map((a) => a.userId)))
  const allTaskIds = Array.from(
    new Set(assignments.flatMap((a) => a.workflow.tasks.map((t) => t.taskId))),
  )

  const userTasks = await prisma.userTask.findMany({
    where: { userId: { in: userIds }, taskId: { in: allTaskIds } },
    select: { userId: true, taskId: true, completed: true, approvalStatus: true },
  })

  // Index userTasks: userId -> taskId -> { completed, approvalStatus }
  type TaskInfo = { completed: boolean; approvalStatus: string }
  const userTaskMap = new Map<string, Map<string, TaskInfo>>()
  for (const ut of userTasks) {
    if (!userTaskMap.has(ut.userId)) userTaskMap.set(ut.userId, new Map())
    userTaskMap.get(ut.userId)!.set(ut.taskId, {
      completed: ut.completed,
      approvalStatus: ut.approvalStatus,
    })
  }

  // Group by user and compute per-workflow completion stats
  const byUser = new Map<string, UserProgress>()
  for (const assignment of assignments) {
    const taskIds = assignment.workflow.tasks.map((t) => t.taskId)
    const taskMap = userTaskMap.get(assignment.userId) ?? new Map<string, TaskInfo>()

    let completedTasks = 0
    let pendingApprovalCount = 0
    for (const taskId of taskIds) {
      const info = taskMap.get(taskId)
      if (info?.completed) {
        completedTasks++
        if (info.approvalStatus === 'PENDING') pendingApprovalCount++
      }
    }

    const totalTasks = taskIds.length
    const completionPct =
      totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

    if (!byUser.has(assignment.userId)) {
      byUser.set(assignment.userId, {
        userId: assignment.userId,
        username: assignment.user.username,
        workflows: [],
      })
    }
    byUser.get(assignment.userId)!.workflows.push({
      userWorkflowId: assignment.id,
      workflowId: assignment.workflowId,
      workflowName: assignment.workflow.name,
      totalTasks,
      completedTasks,
      completionPct,
      pendingApprovalCount,
    })
  }

  return NextResponse.json(Array.from(byUser.values()))
}
