import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { redirect } from 'next/navigation'
import { canViewAllTasks } from '@/lib/permissions'
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
  const canViewOthers = canViewAllTasks(session.user.role as Role)

  // Users can only view their own checklist
  if (!isOwnPage && !canViewOthers) {
    return (
      <div className="text-red-600 font-medium">
        Access denied. You can only view your own checklist.
      </div>
    )
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: viewingUserId },
    select: { id: true, username: true, role: true, active: true },
  })

  if (!targetUser) {
    return <div className="text-gray-600">User not found.</div>
  }

  // Get tasks applicable to this user's role
  const tasks = await prisma.onboardingTask.findMany({
    where: {
      assignedRole: {
        has: targetUser.role,
      },
    },
    orderBy: { order: 'asc' },
  })

  // Get existing UserTask records, including linked document filename (not storagePath)
  const userTasks = await prisma.userTask.findMany({
    where: { userId: viewingUserId },
    include: {
      document: {
        select: { filename: true },
      },
    },
  })

  const userTaskMap = new Map(userTasks.map((ut) => [ut.taskId, ut]))

  const taskList = tasks.map((task) => {
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
    }
  })

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">
        {isOwnPage ? 'My Onboarding Checklist' : `${targetUser.username}'s Checklist`}
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        {taskList.filter((t) => t.completed).length} of {taskList.length} tasks completed
      </p>

      <ChecklistView
        tasks={taskList}
        userId={viewingUserId}
        isOwnPage={isOwnPage}
        canManage={canViewOthers}
        viewerRole={session.user.role as string}
      />
    </div>
  )
}
