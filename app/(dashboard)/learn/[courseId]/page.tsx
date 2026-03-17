import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { redirect } from 'next/navigation'
import { sanitizeCourseHtml } from '@/lib/sanitize'
import CourseTaker from './CourseTaker'

interface PageProps {
  params: { courseId: string }
}

export default async function LearnPage({ params }: PageProps) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const { courseId } = params

  // Verify workflow membership
  const membership = await prisma.workflowTask.findFirst({
    where: {
      task: {
        taskType: 'LEARNING',
        courseId,
      },
      workflow: {
        userWorkflows: {
          some: { userId: session.user.id },
        },
      },
    },
    select: { taskId: true },
  })

  if (!membership) {
    redirect('/dashboard')
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      title: true,
      description: true,
      contentHtml: true,
      passingScore: true,
      questions: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          text: true,
          order: true,
          answers: {
            orderBy: { order: 'asc' },
            select: { id: true, text: true, order: true },
          },
        },
      },
    },
  })

  if (!course) redirect('/dashboard')

  const attempts = await prisma.courseAttempt.findMany({
    where: { userId: session.user.id, courseId },
    select: { id: true, score: true, passed: true, attemptNumber: true, completedAt: true },
    orderBy: { attemptNumber: 'asc' },
  })

  return (
    <div className="py-6 px-4">
      <CourseTaker
        course={{ ...course, contentHtml: sanitizeCourseHtml(course.contentHtml) }}
        attempts={attempts.map((a) => ({ ...a, completedAt: a.completedAt.toISOString() }))}
        taskId={membership.taskId}
      />
    </div>
  )
}
