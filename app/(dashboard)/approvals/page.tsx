import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canApprove, canApproveAny } from '@/lib/permissions'
import { redirect } from 'next/navigation'
import type { Role } from '@prisma/client'
import ApprovalQueue from './ApprovalQueue'

export default async function ApprovalsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const role = session.user.role as Role

  if (!canApprove(role)) {
    return (
      <div className="text-red-600 font-medium">
        Access denied. Approver role is required.
      </div>
    )
  }

  // Build the where clause based on role
  const where = canApproveAny(role)
    ? { completed: true, approvalStatus: 'PENDING' as const }
    : {
        completed: true,
        approvalStatus: 'PENDING' as const,
        task: {
          workflowTasks: {
            some: {
              workflow: {
                userWorkflows: { some: { supervisorId: session.user.id } },
              },
            },
          },
        },
        user: {
          userWorkflows: { some: { supervisorId: session.user.id } },
        },
      }

  const pending = await prisma.userTask.findMany({
    where,
    include: {
      task: true,
      user: { select: { id: true, username: true } },
      document: { select: { id: true, filename: true } },
    },
    orderBy: { updatedAt: 'asc' },
  })

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Approval Queue</h1>
      <p className="text-sm text-gray-500 mb-6">
        {pending.length} task{pending.length !== 1 ? 's' : ''} awaiting review
      </p>

      <ApprovalQueue
        items={pending.map((ut) => ({
          userTaskId: ut.id,
          userId: ut.userId,
          username: ut.user.username,
          taskId: ut.taskId,
          taskTitle: ut.task.title,
          taskType: ut.task.taskType,
          completedAt: ut.completedAt?.toISOString() ?? null,
          documentFilename: ut.document?.filename ?? null,
        }))}
      />
    </div>
  )
}
