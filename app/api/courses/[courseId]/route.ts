import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageCourses, isAdmin } from '@/lib/permissions'
import { checkCourseMgmtRateLimit } from '@/lib/ratelimit'
import { sanitizeCourseHtml, validateHtmlLength } from '@/lib/sanitize'
import {
  validateCuid,
  validateTitle,
  validateDescription,
  validatePassingScore,
  validateCourseQuestions,
} from '@/lib/validation'
import type { Role } from '@prisma/client'

interface RouteContext {
  params: { courseId: string }
}

// GET /api/courses/[courseId] -- full course for authoring (HR+, includes isCorrect)
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!canManageCourses(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const cuidErr = validateCuid(params.courseId, 'courseId')
  if (cuidErr) return NextResponse.json({ error: cuidErr }, { status: 400 })

  const course = await prisma.course.findUnique({
    where: { id: params.courseId },
    include: {
      questions: {
        orderBy: { order: 'asc' },
        include: { answers: { orderBy: { order: 'asc' } } },
      },
    },
  })

  if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 })

  return NextResponse.json(course)
}

// PUT /api/courses/[courseId] -- replace course (HR+)
export async function PUT(req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!canManageCourses(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await checkCourseMgmtRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const cuidErr = validateCuid(params.courseId, 'courseId')
  if (cuidErr) return NextResponse.json({ error: cuidErr }, { status: 400 })

  const existing = await prisma.course.findUnique({ where: { id: params.courseId } })
  if (!existing) return NextResponse.json({ error: 'Course not found' }, { status: 404 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { title, description, contentHtml, passingScore, questions } = body as Record<string, unknown>

  if (title !== undefined) {
    const err = validateTitle(title)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
  }
  if (description !== undefined) {
    const err = validateDescription(description)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
  }
  if (contentHtml !== undefined) {
    if (typeof contentHtml !== 'string') {
      return NextResponse.json({ error: 'contentHtml must be a string' }, { status: 400 })
    }
    const htmlLenErr = validateHtmlLength(contentHtml)
    if (htmlLenErr) return NextResponse.json({ error: htmlLenErr }, { status: 400 })
  }
  if (passingScore !== undefined) {
    const err = validatePassingScore(passingScore)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
  }
  if (questions !== undefined) {
    const err = validateCourseQuestions(questions)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
  }

  const course = await prisma.$transaction(async (tx) => {
    if (questions !== undefined) {
      await tx.courseQuestion.deleteMany({ where: { courseId: params.courseId } })
    }

    return tx.course.update({
      where: { id: params.courseId },
      data: {
        ...(title !== undefined && { title: (title as string).trim() }),
        ...(description !== undefined && {
          description: typeof description === 'string' ? description.trim() : null,
        }),
        ...(contentHtml !== undefined && { contentHtml: sanitizeCourseHtml(contentHtml as string) }),
        ...(passingScore !== undefined && { passingScore: passingScore as number }),
        ...(questions !== undefined && {
          questions: {
            create: (questions as Array<Record<string, unknown>>).map((q, qi) => ({
              text: (q.text as string).trim(),
              order: typeof q.order === 'number' ? q.order : qi,
              answers: {
                create: (q.answers as Array<Record<string, unknown>>).map((a, ai) => ({
                  text: (a.text as string).trim(),
                  isCorrect: a.isCorrect === true,
                  order: typeof a.order === 'number' ? a.order : ai,
                })),
              },
            })),
          },
        }),
      },
      include: {
        questions: {
          orderBy: { order: 'asc' },
          include: { answers: { orderBy: { order: 'asc' } } },
        },
      },
    })
  })

  return NextResponse.json(course)
}

// DELETE /api/courses/[courseId] -- delete course (ADMIN only)
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isAdmin(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await checkCourseMgmtRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const cuidErr = validateCuid(params.courseId, 'courseId')
  if (cuidErr) return NextResponse.json({ error: cuidErr }, { status: 400 })

  const existing = await prisma.course.findUnique({
    where: { id: params.courseId },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'Course not found' }, { status: 404 })

  const attemptCount = await prisma.courseAttempt.count({ where: { courseId: params.courseId } })
  if (attemptCount > 0) {
    return NextResponse.json(
      { error: 'Cannot delete a course that has attempt records.' },
      { status: 409 },
    )
  }

  const taskCount = await prisma.onboardingTask.count({ where: { courseId: params.courseId } })
  if (taskCount > 0) {
    return NextResponse.json(
      { error: 'Cannot delete a course linked to onboarding tasks. Unlink all tasks first.' },
      { status: 409 },
    )
  }

  await prisma.course.delete({ where: { id: params.courseId } })

  return NextResponse.json({ deleted: true })
}
