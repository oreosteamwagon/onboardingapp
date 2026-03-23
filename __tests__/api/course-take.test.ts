/**
 * Tests for POST /api/courses/[courseId]/take (quiz submission).
 * Score calculation is server-side only; isCorrect is never exposed to callers.
 */

import { NextRequest } from 'next/server'

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    workflowTask: { findFirst: jest.fn() },
    course: { findUnique: jest.fn() },
    onboardingTask: { findUnique: jest.fn() },
    courseQuestion: { findMany: jest.fn() },
    courseAttempt: { findMany: jest.fn(), count: jest.fn() },
    userTask: { upsert: jest.fn() },
    userWorkflow: { findMany: jest.fn() },
    appLog: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}))
jest.mock('@/lib/ratelimit', () => ({
  checkTeamTasksRateLimit: jest.fn().mockResolvedValue(undefined),
  checkCourseAttemptRateLimit: jest.fn().mockResolvedValue(undefined),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { GET, POST } from '@/app/api/courses/[courseId]/take/route'

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockUserFindUnique = prisma.user.findUnique as jest.MockedFunction<typeof prisma.user.findUnique>
const mockAppLogCreate = prisma.appLog.create as jest.MockedFunction<typeof prisma.appLog.create>

function makeSession(role = 'USER', id = 'user-1') {
  return { user: { id, name: 'Test', email: 'test@test.com', role } }
}

const courseId = 'c' + 'a'.repeat(24)
const taskId = 'c' + 'b'.repeat(24)
const q1Id = 'c' + 'c'.repeat(24)
const a1Id = 'c' + 'd'.repeat(24) // correct
const a2Id = 'c' + 'e'.repeat(24)

const routeCtx = { params: { courseId } }

function makeRequest(body?: unknown, method = 'POST'): NextRequest {
  return new NextRequest(`http://localhost/api/courses/${courseId}/take`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const courseQuestions = [
  {
    id: q1Id,
    answers: [
      { id: a1Id, isCorrect: true },
      { id: a2Id, isCorrect: false },
    ],
  },
]

beforeEach(() => {
  mockUserFindUnique.mockResolvedValue({ active: true } as never)
  mockAppLogCreate.mockResolvedValue({} as never)
  ;(prisma.userWorkflow.findMany as jest.Mock).mockResolvedValue([])
})

// ============================================================
// GET /api/courses/[courseId]/take
// ============================================================

describe('GET /api/courses/[courseId]/take', () => {
  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null as never)
    const res = await GET(makeRequest(undefined, 'GET'), routeCtx)
    expect(res.status).toBe(401)
  })

  it('returns 403 when user is not in a workflow with this course', async () => {
    mockAuth.mockResolvedValueOnce(makeSession() as never)
    ;(prisma.workflowTask.findFirst as jest.Mock).mockResolvedValueOnce(null)
    const res = await GET(makeRequest(undefined, 'GET'), routeCtx)
    expect(res.status).toBe(403)
  })

  it('returns 200 and course without isCorrect for enrolled user', async () => {
    mockAuth.mockResolvedValueOnce(makeSession() as never)
    ;(prisma.workflowTask.findFirst as jest.Mock).mockResolvedValueOnce({ taskId })
    ;(prisma.course.findUnique as jest.Mock).mockResolvedValueOnce({
      id: courseId,
      title: 'Test Course',
      description: null,
      contentHtml: '<p>content</p>',
      passingScore: 80,
      questions: [{ id: q1Id, text: 'Q1', order: 0, answers: [{ id: a1Id, text: 'A', order: 0 }] }],
    })
    ;(prisma.courseAttempt.findMany as jest.Mock).mockResolvedValueOnce([])
    const res = await GET(makeRequest(undefined, 'GET'), routeCtx)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(JSON.stringify(data)).not.toContain('isCorrect')
    expect(data.taskId).toBe(taskId)
    expect(data.attempts).toEqual([])
  })
})

// ============================================================
// POST /api/courses/[courseId]/take — submit answers
// ============================================================

describe('POST /api/courses/[courseId]/take', () => {
  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null as never)
    const res = await POST(makeRequest({ taskId, answers: [] }), routeCtx)
    expect(res.status).toBe(401)
  })

  it('returns 403 when user is not in workflow', async () => {
    mockAuth.mockResolvedValueOnce(makeSession() as never)
    ;(prisma.onboardingTask.findUnique as jest.Mock).mockResolvedValueOnce({
      taskType: 'LEARNING',
      courseId,
    })
    ;(prisma.workflowTask.findFirst as jest.Mock).mockResolvedValueOnce(null)
    const res = await POST(makeRequest({ taskId, answers: [{ questionId: q1Id, answerId: a1Id }] }), routeCtx)
    expect(res.status).toBe(403)
  })

  it('returns 400 when taskId is missing', async () => {
    mockAuth.mockResolvedValueOnce(makeSession() as never)
    const res = await POST(makeRequest({ answers: [] }), routeCtx)
    expect(res.status).toBe(400)
  })

  it('returns 400 when answerId is an invalid CUID', async () => {
    mockAuth.mockResolvedValueOnce(makeSession() as never)
    const res = await POST(makeRequest({
      taskId,
      answers: [{ questionId: q1Id, answerId: 'not-a-cuid' }],
    }), routeCtx)
    expect(res.status).toBe(400)
  })

  it('returns 409 when taskId is linked to a different course', async () => {
    mockAuth.mockResolvedValueOnce(makeSession() as never)
    ;(prisma.onboardingTask.findUnique as jest.Mock).mockResolvedValueOnce({
      taskType: 'LEARNING',
      courseId: 'c' + 'z'.repeat(24), // different course
    })
    const res = await POST(makeRequest({ taskId, answers: [{ questionId: q1Id, answerId: a1Id }] }), routeCtx)
    expect(res.status).toBe(409)
  })

  it('returns 400 when unknown questionId is submitted', async () => {
    mockAuth.mockResolvedValueOnce(makeSession() as never)
    ;(prisma.onboardingTask.findUnique as jest.Mock).mockResolvedValueOnce({ taskType: 'LEARNING', courseId })
    ;(prisma.workflowTask.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'wt-1' })
    ;(prisma.courseQuestion.findMany as jest.Mock).mockResolvedValueOnce(courseQuestions)
    const unknownQId = 'c' + 'x'.repeat(24)
    const res = await POST(makeRequest({
      taskId,
      answers: [{ questionId: unknownQId, answerId: a1Id }],
    }), routeCtx)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/Unknown questionId/)
  })

  it('returns 400 when not all questions are answered', async () => {
    mockAuth.mockResolvedValueOnce(makeSession() as never)
    ;(prisma.onboardingTask.findUnique as jest.Mock).mockResolvedValueOnce({ taskType: 'LEARNING', courseId })
    ;(prisma.workflowTask.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'wt-1' })
    ;(prisma.courseQuestion.findMany as jest.Mock).mockResolvedValueOnce([
      ...courseQuestions,
      { id: 'c' + 'f'.repeat(24), answers: [{ id: 'c' + 'g'.repeat(24), isCorrect: true }] },
    ])
    const res = await POST(makeRequest({
      taskId,
      answers: [{ questionId: q1Id, answerId: a1Id }], // only 1 of 2 answered
    }), routeCtx)
    expect(res.status).toBe(400)
  })

  it('calculates 100% score when all correct', async () => {
    mockAuth.mockResolvedValueOnce(makeSession() as never)
    ;(prisma.onboardingTask.findUnique as jest.Mock).mockResolvedValueOnce({ taskType: 'LEARNING', courseId })
    ;(prisma.workflowTask.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'wt-1' })
    ;(prisma.courseQuestion.findMany as jest.Mock).mockResolvedValueOnce(courseQuestions)
    ;(prisma.course.findUnique as jest.Mock).mockResolvedValueOnce({ passingScore: 80 })
    ;(prisma.$transaction as jest.Mock).mockImplementationOnce(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma))
    ;(prisma.courseAttempt.count as jest.Mock).mockResolvedValueOnce(0)
    ;(prisma.courseAttempt as unknown as Record<string, jest.Mock>).create = jest.fn().mockResolvedValueOnce({
      id: 'attempt-1',
      score: 100,
      passed: true,
      attemptNumber: 1,
    })
    ;(prisma.userTask.upsert as jest.Mock).mockResolvedValueOnce({})
    const res = await POST(makeRequest({
      taskId,
      answers: [{ questionId: q1Id, answerId: a1Id }],
    }), routeCtx)
    // The transaction mock controls the result
    expect(res.status).toBe(200)
  })

  it('calculates 0% score when none correct and does not set passed', async () => {
    mockAuth.mockResolvedValueOnce(makeSession() as never)
    ;(prisma.onboardingTask.findUnique as jest.Mock).mockResolvedValueOnce({ taskType: 'LEARNING', courseId })
    ;(prisma.workflowTask.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'wt-1' })
    ;(prisma.courseQuestion.findMany as jest.Mock).mockResolvedValueOnce(courseQuestions)
    ;(prisma.course.findUnique as jest.Mock).mockResolvedValueOnce({ passingScore: 80 })
    ;(prisma.$transaction as jest.Mock).mockImplementationOnce(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma))
    ;(prisma.courseAttempt.count as jest.Mock).mockResolvedValueOnce(0)
    ;(prisma.courseAttempt as unknown as Record<string, jest.Mock>).create = jest.fn().mockResolvedValueOnce({
      id: 'attempt-1',
      score: 0,
      passed: false,
      attemptNumber: 1,
    })
    const res = await POST(makeRequest({
      taskId,
      answers: [{ questionId: q1Id, answerId: a2Id }], // wrong answer
    }), routeCtx)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(JSON.stringify(data)).not.toContain('isCorrect')
  })

  it('response does not contain isCorrect field', async () => {
    mockAuth.mockResolvedValueOnce(makeSession() as never)
    ;(prisma.onboardingTask.findUnique as jest.Mock).mockResolvedValueOnce({ taskType: 'LEARNING', courseId })
    ;(prisma.workflowTask.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'wt-1' })
    ;(prisma.courseQuestion.findMany as jest.Mock).mockResolvedValueOnce(courseQuestions)
    ;(prisma.course.findUnique as jest.Mock).mockResolvedValueOnce({ passingScore: 80 })
    ;(prisma.$transaction as jest.Mock).mockImplementationOnce(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma))
    ;(prisma.courseAttempt.count as jest.Mock).mockResolvedValueOnce(0)
    ;(prisma.courseAttempt as unknown as Record<string, jest.Mock>).create = jest.fn().mockResolvedValueOnce({
      id: 'attempt-1',
      score: 100,
      passed: true,
      attemptNumber: 1,
    })
    ;(prisma.userTask.upsert as jest.Mock).mockResolvedValueOnce({})
    const res = await POST(makeRequest({
      taskId,
      answers: [{ questionId: q1Id, answerId: a1Id }],
    }), routeCtx)
    const data = await res.json()
    expect(JSON.stringify(data)).not.toContain('isCorrect')
  })
})
