import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageCourses } from '@/lib/permissions'
import { checkCourseMgmtRateLimit } from '@/lib/ratelimit'
import { sanitizeCourseHtml, validateHtmlLength } from '@/lib/sanitize'
import {
  validateTitle,
  validateDescription,
  validatePassingScore,
  validateCourseQuestions,
} from '@/lib/validation'
import { log } from '@/lib/logger'
import type { Role } from '@prisma/client'

// GET /api/courses -- list all courses (HR+ only)
export async function GET() {
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

  return NextResponse.json(courses)
}

// POST /api/courses -- create a course (HR+ only)
export async function POST(req: NextRequest) {
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

  const titleErr = validateTitle(title)
  if (titleErr) return NextResponse.json({ error: titleErr }, { status: 400 })

  const descErr = validateDescription(description)
  if (descErr) return NextResponse.json({ error: descErr }, { status: 400 })

  if (typeof contentHtml !== 'string') {
    return NextResponse.json({ error: 'contentHtml is required' }, { status: 400 })
  }
  const htmlLenErr = validateHtmlLength(contentHtml)
  if (htmlLenErr) return NextResponse.json({ error: htmlLenErr }, { status: 400 })

  const scoreErr = validatePassingScore(passingScore)
  if (scoreErr) return NextResponse.json({ error: scoreErr }, { status: 400 })

  const questionsErr = validateCourseQuestions(questions)
  if (questionsErr) return NextResponse.json({ error: questionsErr }, { status: 400 })

  const sanitizedHtml = sanitizeCourseHtml(contentHtml)

  const course = await prisma.$transaction(async (tx) => {
    return tx.course.create({
      data: {
        title: (title as string).trim(),
        description: typeof description === 'string' ? description.trim() : null,
        contentHtml: sanitizedHtml,
        passingScore: passingScore as number,
        createdById: session.user.id,
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
      },
      select: { id: true, title: true, passingScore: true, createdAt: true },
    })
  })

  log({ message: 'course created', action: 'course_create', userId: session.user.id, statusCode: 201, meta: { courseId: course.id } })
  return NextResponse.json(course, { status: 201 })
}
