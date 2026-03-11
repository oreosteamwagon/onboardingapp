import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { redirect } from 'next/navigation'
import { canApprove, canApproveAny } from '@/lib/permissions'
import type { Role } from '@prisma/client'
import ChecklistView from './ChecklistView'

interface PageProps {
  params: { userId: string }
}

export default async function OnboardingPage({ params }: PageProps) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const viewingUserId = params.userId
  const isOwnPage = viewingUserId === session.user.id
  const viewerRole = session.user.role as Role

  // Access control:
  // - Users may view their own checklist
  // - Admin/Payroll/HR may view anyone's checklist
  // - Supervisors may view checklists of users in workflows they supervise
  if (!isOwnPage) {
    if (canApproveAny(viewerRole)) {
      // allowed
    } else if (canApprove(viewerRole)) {
      // Supervisor — verify this user is in a workflow they supervise
      const supervised = await prisma.userWorkflow.findFirst({
        where: { userId: viewingUserId, supervisorId: session.user.id },
        select: { id: true },
      })
      if (!supervised) {
        return (
          <div className="text-red-600 font-medium">
            Access denied. You are not the designated supervisor for this user.
          </div>
        )
      }
    } else {
      return (
        <div className="text-red-600 font-medium">
          Access denied. You can only view your own checklist.
        </div>
      )
    }
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: viewingUserId },
    select: { id: true, username: true, role: true, active: true },
  })

  if (!targetUser) {
    return <div className="text-gray-600">User not found.</div>
  }

  // Fetch all workflow assignments for this user, with tasks ordered within each workflow
  const userWorkflows = await prisma.userWorkflow.findMany({
    where: { userId: viewingUserId },
    include: {
      workflow: {
        include: {
          tasks: {
            include: { task: true },
            orderBy: { order: 'asc' },
          },
        },
      },
      supervisor: { select: { id: true, username: true } },
    },
    orderBy: { assignedAt: 'asc' },
  })

  // Fetch all UserTask records for this user, including document and approval info
  const userTaskRecords = await prisma.userTask.findMany({
    where: { userId: viewingUserId },
    include: {
      document: { select: { filename: true } },
      approvedBy: { select: { id: true, username: true } },
    },
  })

  const userTaskMap = new Map(userTaskRecords.map((ut) => [ut.taskId, ut]))

  // Build the grouped structure: one list of tasks per workflow assignment
  const workflows = userWorkflows.map((uw) => ({
    id: uw.id,
    workflowId: uw.workflow.id,
    workflowName: uw.workflow.name,
    workflowDescription: uw.workflow.description,
    supervisor: uw.supervisor,
    tasks: uw.workflow.tasks.map(({ task }) => {
      const ut = userTaskMap.get(task.id)
      return {
        id: task.id,
        title: task.title,
        description: task.description,
        taskType: task.taskType,
        order: task.order,
        completed: ut?.completed ?? false,
        completedAt: ut?.completedAt?.toISOString() ?? null,
        userTaskId: ut?.id ?? null,
        documentFilename: ut?.document?.filename ?? null,
        approvalStatus: ut?.approvalStatus ?? 'PENDING',
        approvedAt: ut?.approvedAt?.toISOString() ?? null,
        approvedByUsername: ut?.approvedBy?.username ?? null,
      }
    }),
  }))

  const totalTasks = workflows.reduce((sum, w) => sum + w.tasks.length, 0)
  const completedTasks = workflows.reduce(
    (sum, w) => sum + w.tasks.filter((t) => t.completed).length,
    0,
  )

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">
        {isOwnPage ? 'My Onboarding Checklist' : `${targetUser.username}'s Checklist`}
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        {completedTasks} of {totalTasks} tasks completed
      </p>

      {workflows.length === 0 ? (
        <div className="text-gray-500 text-sm">No workflows have been assigned yet.</div>
      ) : (
        <ChecklistView
          workflows={workflows}
          userId={viewingUserId}
          isOwnPage={isOwnPage}
        />
      )}
    </div>
  )
}
