import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { checkTeamTasksRateLimit, checkCourseAttemptRateLimit } from '@/lib/ratelimit'
import { verifyActiveSession } from '@/lib/session'
import { sanitizeCourseHtml } from '@/lib/sanitize'
import { validateCuid, validateAnswerSubmission } from '@/lib/validation'
import { checkAndNotifyWorkflowCompletion } from '@/lib/email'
import type { Role } from '@prisma/client'

interface RouteContext {
  params: { courseId: string }
}

// GET /api/courses/[courseId]/take -- fetch course for taking (any authenticated user)
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!await verifyActiveSession(session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await checkTeamTasksRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const cuidErr = validateCuid(params.courseId, 'courseId')
  if (cuidErr) return NextResponse.json({ error: cuidErr }, { status: 400 })

  // Verify workflow membership: a LEARNING task with this courseId must be in a workflow assigned to user
  const membership = await prisma.workflowTask.findFirst({
    where: {
      task: {
        taskType: 'LEARNING',
        courseId: params.courseId,
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
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const course = await prisma.course.findUnique({
    where: { id: params.courseId },
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
            select: {
              id: true,
              text: true,
              order: true,
              // isCorrect intentionally excluded
            },
          },
        },
      },
    },
  })

  if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 })

  const attempts = await prisma.courseAttempt.findMany({
    where: { userId: session.user.id, courseId: params.courseId },
    select: { id: true, score: true, passed: true, attemptNumber: true, completedAt: true },
    orderBy: { attemptNumber: 'asc' },
  })

  return NextResponse.json({
    course: { ...course, contentHtml: sanitizeCourseHtml(course.contentHtml) },
    attempts,
    taskId: membership.taskId,
  })
}

// POST /api/courses/[courseId]/take -- submit answers (any authenticated user)
export async function POST(req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!await verifyActiveSession(session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await checkCourseAttemptRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const cuidErr = validateCuid(params.courseId, 'courseId')
  if (cuidErr) return NextResponse.json({ error: cuidErr }, { status: 400 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { taskId, answers } = body as Record<string, unknown>

  const taskIdErr = validateCuid(taskId, 'taskId')
  if (taskIdErr) return NextResponse.json({ error: taskIdErr }, { status: 400 })

  const answersErr = validateAnswerSubmission(answers)
  if (answersErr) return NextResponse.json({ error: answersErr }, { status: 400 })

  // Verify task exists, is LEARNING type, and is linked to this course
  const task = await prisma.onboardingTask.findUnique({
    where: { id: taskId as string },
    select: { taskType: true, courseId: true },
  })

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }
  if (task.taskType !== 'LEARNING') {
    return NextResponse.json({ error: 'Task is not a LEARNING task' }, { status: 409 })
  }
  if (task.courseId !== params.courseId) {
    return NextResponse.json({ error: 'taskId is not linked to this course' }, { status: 409 })
  }

  // Workflow membership check
  const membership = await prisma.workflowTask.findFirst({
    where: {
      taskId: taskId as string,
      workflow: {
        userWorkflows: {
          some: { userId: session.user.id },
        },
      },
    },
  })

  if (!membership) {
    return NextResponse.json({ error: 'Task not assigned to you' }, { status: 403 })
  }

  // Fetch all questions + correct answers for this course (server-side scoring)
  const courseQuestions = await prisma.courseQuestion.findMany({
    where: { courseId: params.courseId },
    select: {
      id: true,
      answers: { select: { id: true, isCorrect: true } },
    },
  })

  const submittedAnswers = answers as Array<{ questionId: string; answerId: string }>

  // Verify all question IDs belong to this course
  const validQuestionIds = new Set(courseQuestions.map((q) => q.id))
  for (const sub of submittedAnswers) {
    if (!validQuestionIds.has(sub.questionId)) {
      return NextResponse.json({ error: `Unknown questionId: ${sub.questionId}` }, { status: 400 })
    }
    // Verify answerId belongs to the question
    const question = courseQuestions.find((q) => q.id === sub.questionId)
    if (!question) continue
    const validAnswerIds = new Set(question.answers.map((a) => a.id))
    if (!validAnswerIds.has(sub.answerId)) {
      return NextResponse.json({ error: `Unknown answerId: ${sub.answerId}` }, { status: 400 })
    }
  }

  // Verify all questions are answered
  if (submittedAnswers.length !== courseQuestions.length) {
    return NextResponse.json(
      { error: `Expected ${courseQuestions.length} answers, got ${submittedAnswers.length}` },
      { status: 400 },
    )
  }

  // Calculate score server-side
  let correctCount = 0
  for (const sub of submittedAnswers) {
    const question = courseQuestions.find((q) => q.id === sub.questionId)
    if (!question) continue
    const correctAnswer = question.answers.find((a) => a.isCorrect)
    if (correctAnswer && correctAnswer.id === sub.answerId) {
      correctCount++
    }
  }

  const score = Math.round((correctCount / courseQuestions.length) * 100)

  // Fetch course for passing score
  const course = await prisma.course.findUnique({
    where: { id: params.courseId },
    select: { passingScore: true },
  })

  if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 })

  const passed = score >= course.passingScore

  const result = await prisma.$transaction(async (tx) => {
    const attemptNumber =
      (await tx.courseAttempt.count({ where: { userId: session.user.id, courseId: params.courseId } })) + 1

    const attempt = await tx.courseAttempt.create({
      data: {
        userId: session.user.id,
        courseId: params.courseId,
        taskId: taskId as string,
        score,
        passed,
        attemptNumber,
      },
      select: { id: true, score: true, passed: true, attemptNumber: true },
    })

    if (passed) {
      await tx.userTask.upsert({
        where: { userId_taskId: { userId: session.user.id, taskId: taskId as string } },
        create: {
          userId: session.user.id,
          taskId: taskId as string,
          completed: true,
          completedAt: new Date(),
          approvalStatus: 'APPROVED',
          approvedAt: new Date(),
        },
        update: {
          completed: true,
          completedAt: new Date(),
          approvalStatus: 'APPROVED',
          approvedAt: new Date(),
        },
      })
    }

    return attempt
  })

  if (passed) {
    void checkAndNotifyWorkflowCompletion(session.user.id, taskId as string)
  }

  return NextResponse.json({
    attemptId: result.id,
    score: result.score,
    passed: result.passed,
    passingScore: course.passingScore,
    attemptNumber: result.attemptNumber,
  })
}
