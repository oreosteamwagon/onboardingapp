/**
 * Tests for /api/courses (GET, POST) and /api/courses/[courseId] (GET, PUT, DELETE).
 */

import { NextRequest } from 'next/server'

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/db', () => ({
  prisma: {
    course: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    courseQuestion: {
      deleteMany: jest.fn(),
    },
    courseAttempt: {
      count: jest.fn(),
    },
    onboardingTask: {
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}))
jest.mock('@/lib/ratelimit', () => ({
  checkCourseMgmtRateLimit: jest.fn().mockResolvedValue(undefined),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { GET, POST } from '@/app/api/courses/route'
import {
  GET as getCourse,
  PUT as putCourse,
  DELETE as deleteCourse,
} from '@/app/api/courses/[courseId]/route'

const mockAuth = auth as jest.MockedFunction<typeof auth>

function makeSession(role: string, id = 'user-1') {
  return { user: { id, name: 'Test', email: 'test@test.com', role } }
}

function makeRequest(body?: unknown, method = 'POST', url = 'http://localhost/api/courses'): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const validCourseBody = {
  title: 'Safety Training',
  contentHtml: '<p>Content here</p>',
  passingScore: 80,
  questions: [
    {
      text: 'What is safety?',
      order: 0,
      answers: [
        { text: 'Being careful', isCorrect: true, order: 0 },
        { text: 'Being reckless', isCorrect: false, order: 1 },
      ],
    },
  ],
}

const sampleCourse = {
  id: 'c' + 'a'.repeat(24),
  title: 'Safety Training',
  passingScore: 80,
  createdAt: new Date(),
}

const courseRouteCtx = { params: { courseId: 'c' + 'a'.repeat(24) } }

// ============================================================
// GET /api/courses
// ============================================================

describe('GET /api/courses', () => {
  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null as never)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns 403 for USER role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('returns 403 for PAYROLL role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('PAYROLL') as never)
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('returns 200 for HR role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    ;(prisma.course.findMany as jest.Mock).mockResolvedValueOnce([])
    const res = await GET()
    expect(res.status).toBe(200)
  })

  it('returns 200 for ADMIN role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    ;(prisma.course.findMany as jest.Mock).mockResolvedValueOnce([])
    const res = await GET()
    expect(res.status).toBe(200)
  })
})

// ============================================================
// POST /api/courses
// ============================================================

describe('POST /api/courses', () => {
  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null as never)
    const res = await POST(makeRequest(validCourseBody))
    expect(res.status).toBe(401)
  })

  it('returns 403 for USER role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    const res = await POST(makeRequest(validCourseBody))
    expect(res.status).toBe(403)
  })

  it('returns 400 when title is missing', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const { title: _, ...noTitle } = validCourseBody
    const res = await POST(makeRequest(noTitle))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/title/)
  })

  it('returns 400 when passingScore is 0', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await POST(makeRequest({ ...validCourseBody, passingScore: 0 }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/passingScore/)
  })

  it('returns 400 when passingScore is 101', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await POST(makeRequest({ ...validCourseBody, passingScore: 101 }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/passingScore/)
  })

  it('returns 400 when passingScore is a string', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await POST(makeRequest({ ...validCourseBody, passingScore: '80' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/passingScore/)
  })

  it('returns 400 with zero questions', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await POST(makeRequest({ ...validCourseBody, questions: [] }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/question/)
  })

  it('returns 400 when question has only 1 answer', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const body = {
      ...validCourseBody,
      questions: [{
        text: 'Q?',
        order: 0,
        answers: [{ text: 'A', isCorrect: true, order: 0 }],
      }],
    }
    const res = await POST(makeRequest(body))
    expect(res.status).toBe(400)
  })

  it('returns 400 when question has 5 answers', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const body = {
      ...validCourseBody,
      questions: [{
        text: 'Q?',
        order: 0,
        answers: Array.from({ length: 5 }, (_, i) => ({ text: `A${i}`, isCorrect: i === 0, order: i })),
      }],
    }
    const res = await POST(makeRequest(body))
    expect(res.status).toBe(400)
  })

  it('returns 400 when question has 0 correct answers', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const body = {
      ...validCourseBody,
      questions: [{
        text: 'Q?',
        order: 0,
        answers: [
          { text: 'A', isCorrect: false, order: 0 },
          { text: 'B', isCorrect: false, order: 1 },
        ],
      }],
    }
    const res = await POST(makeRequest(body))
    expect(res.status).toBe(400)
  })

  it('returns 400 when question has 2 correct answers', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const body = {
      ...validCourseBody,
      questions: [{
        text: 'Q?',
        order: 0,
        answers: [
          { text: 'A', isCorrect: true, order: 0 },
          { text: 'B', isCorrect: true, order: 1 },
        ],
      }],
    }
    const res = await POST(makeRequest(body))
    expect(res.status).toBe(400)
  })

  it('returns 201 for valid course and does not include isCorrect', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    ;(prisma.$transaction as jest.Mock).mockImplementationOnce(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma))
    ;(prisma.course.create as jest.Mock).mockResolvedValueOnce(sampleCourse)
    const res = await POST(makeRequest(validCourseBody))
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data).not.toHaveProperty('isCorrect')
    const json = JSON.stringify(data)
    expect(json).not.toContain('isCorrect')
  })
})

// ============================================================
// DELETE /api/courses/[courseId]
// ============================================================

describe('DELETE /api/courses/[courseId]', () => {
  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null as never)
    const res = await deleteCourse(makeRequest(undefined, 'DELETE'), courseRouteCtx)
    expect(res.status).toBe(401)
  })

  it('returns 403 for HR role (not ADMIN)', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await deleteCourse(makeRequest(undefined, 'DELETE'), courseRouteCtx)
    expect(res.status).toBe(403)
  })

  it('returns 404 when course not found', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    ;(prisma.course.findUnique as jest.Mock).mockResolvedValueOnce(null)
    const res = await deleteCourse(makeRequest(undefined, 'DELETE'), courseRouteCtx)
    expect(res.status).toBe(404)
  })

  it('returns 409 when attempts exist', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    ;(prisma.course.findUnique as jest.Mock).mockResolvedValueOnce(sampleCourse)
    ;(prisma.courseAttempt.count as jest.Mock).mockResolvedValueOnce(3)
    const res = await deleteCourse(makeRequest(undefined, 'DELETE'), courseRouteCtx)
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toMatch(/attempt/)
  })

  it('returns 409 when linked tasks exist', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    ;(prisma.course.findUnique as jest.Mock).mockResolvedValueOnce(sampleCourse)
    ;(prisma.courseAttempt.count as jest.Mock).mockResolvedValueOnce(0)
    ;(prisma.onboardingTask.count as jest.Mock).mockResolvedValueOnce(2)
    const res = await deleteCourse(makeRequest(undefined, 'DELETE'), courseRouteCtx)
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toMatch(/task/)
  })

  it('returns 200 when course can be deleted', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    ;(prisma.course.findUnique as jest.Mock).mockResolvedValueOnce(sampleCourse)
    ;(prisma.courseAttempt.count as jest.Mock).mockResolvedValueOnce(0)
    ;(prisma.onboardingTask.count as jest.Mock).mockResolvedValueOnce(0)
    ;(prisma.course.delete as jest.Mock).mockResolvedValueOnce(sampleCourse)
    const res = await deleteCourse(makeRequest(undefined, 'DELETE'), courseRouteCtx)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.deleted).toBe(true)
  })
})
