import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageWorkflows } from '@/lib/permissions'
import { redirect } from 'next/navigation'
import type { Role } from '@prisma/client'
import WorkflowManager from './WorkflowManager'

export default async function AdminWorkflowsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  if (!canManageWorkflows(session.user.role as Role)) {
    return (
      <div className="text-red-600 font-medium">
        Access denied. HR role or above is required to manage workflows.
      </div>
    )
  }

  const [workflows, tasks] = await Promise.all([
    prisma.workflow.findMany({
      orderBy: { name: 'asc' },
      include: {
        tasks: {
          include: { task: true },
          orderBy: { order: 'asc' },
        },
        _count: { select: { userWorkflows: true } },
      },
    }),
    prisma.onboardingTask.findMany({
      orderBy: { order: 'asc' },
    }),
  ])

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Workflow Manager</h1>
      <p className="text-sm text-gray-500 mb-6">
        Create workflows, add tasks to them, and assign them to users.
      </p>
      <WorkflowManager
        workflows={workflows.map((w) => ({
          id: w.id,
          name: w.name,
          description: w.description,
          enrolledCount: w._count.userWorkflows,
          tasks: w.tasks.map((wt) => ({
            workflowTaskId: wt.id,
            taskId: wt.task.id,
            title: wt.task.title,
            taskType: wt.task.taskType,
            order: wt.order,
          })),
        }))}
        availableTasks={tasks.map((t) => ({
          id: t.id,
          title: t.title,
          taskType: t.taskType,
          order: t.order,
        }))}
      />
    </div>
  )
}
