import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { redirect } from 'next/navigation'
import { canApprove, canApproveAny, canAssignWorkflows } from '@/lib/permissions'
import type { Role } from '@prisma/client'
import TeamTasksView from './TeamTasksView'
import type { UserProgress } from '@/app/api/team-tasks/route'

export default async function TeamTasksPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const role = session.user.role as Role
  if (!canApprove(role)) redirect('/dashboard')

  // Scope assignments: Admin/Payroll/HR see all; Supervisor sees only their assigned workflows
  const whereClause = canApproveAny(role)
    ? {}
    : { supervisorId: session.user.id }

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

  // Batch-fetch all relevant UserTasks in one query
  type TaskInfo = { completed: boolean; approvalStatus: string }
  const userTaskMap = new Map<string, Map<string, TaskInfo>>()

  if (assignments.length > 0) {
    const userIds = Array.from(new Set(assignments.map((a) => a.userId)))
    const allTaskIds = Array.from(
      new Set(assignments.flatMap((a) => a.workflow.tasks.map((t) => t.taskId))),
    )
    const userTasks = await prisma.userTask.findMany({
      where: { userId: { in: userIds }, taskId: { in: allTaskIds } },
      select: { userId: true, taskId: true, completed: true, approvalStatus: true },
    })
    for (const ut of userTasks) {
      if (!userTaskMap.has(ut.userId)) userTaskMap.set(ut.userId, new Map())
      userTaskMap.get(ut.userId)!.set(ut.taskId, {
        completed: ut.completed,
        approvalStatus: ut.approvalStatus,
      })
    }
  }

  // Compute per-user, per-workflow stats
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

  const teamData = Array.from(byUser.values())

  // For HR+: fetch data needed to drive the workflow assignment form
  let assignmentOptions: {
    workflows: { id: string; name: string }[]
    users: { id: string; username: string }[]
    supervisors: { id: string; username: string }[]
  } | null = null

  if (canAssignWorkflows(role)) {
    const [workflows, users, supervisors] = await Promise.all([
      prisma.workflow.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      prisma.user.findMany({
        where: { active: true },
        orderBy: { username: 'asc' },
        select: { id: true, username: true },
      }),
      prisma.user.findMany({
        where: { role: 'SUPERVISOR', active: true },
        orderBy: { username: 'asc' },
        select: { id: true, username: true },
      }),
    ])
    assignmentOptions = { workflows, users, supervisors }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Onboarding List</h1>
      <TeamTasksView teamData={teamData} assignmentOptions={assignmentOptions} />
    </div>
  )
}
