import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageTasks, isAdmin } from '@/lib/permissions'
import { redirect } from 'next/navigation'
import type { Role } from '@prisma/client'
import TaskManager from './TaskManager'

export default async function AdminTasksPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  if (!canManageTasks(session.user.role as Role)) {
    return (
      <div className="text-red-600 font-medium">
        Access denied. HR role or above is required to manage tasks.
      </div>
    )
  }

  const tasks = await prisma.onboardingTask.findMany({
    orderBy: { order: 'asc' },
  })

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Checklist Manager</h1>
      <p className="text-sm text-gray-500 mb-6">
        Define and manage onboarding tasks assigned to each role.
      </p>
      <TaskManager
        tasks={tasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          taskType: t.taskType,
          assignedRole: t.assignedRole,
          order: t.order,
        }))}
        viewerIsAdmin={isAdmin(session.user.role as Role)}
      />
    </div>
  )
}
