import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageCourses, isAdmin } from '@/lib/permissions'
import { redirect } from 'next/navigation'
import type { Role } from '@prisma/client'
import CourseManager from './CourseManager'

export default async function AdminLearningPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  if (!canManageCourses(session.user.role as Role)) {
    return (
      <div className="text-red-600 font-medium">
        Access denied. HR role or above is required to manage courses.
      </div>
    )
  }

  const courses = await prisma.course.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      description: true,
      passingScore: true,
      createdAt: true,
      _count: { select: { questions: true, linkedTasks: true, attempts: true } },
    },
  })

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Learning Manager</h1>
      <p className="text-sm text-gray-500 mb-6">
        Create and manage computer-based training courses with quizzes.
      </p>
      <CourseManager
        courses={courses.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }))}
        viewerIsAdmin={isAdmin(session.user.role as Role)}
      />
    </div>
  )
}
