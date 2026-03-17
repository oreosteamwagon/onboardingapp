/**
 * Tests for GET /api/certificates/[attemptId].
 * Certificate data endpoint — object-level auth, failed attempt guard.
 */

import { NextRequest } from 'next/server'

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/db', () => ({
  prisma: {
    courseAttempt: { findUnique: jest.fn() },
    brandingSetting: { findFirst: jest.fn() },
  },
}))
jest.mock('@/lib/ratelimit', () => ({
  checkCertificateRateLimit: jest.fn().mockResolvedValue(undefined),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { GET } from '@/app/api/certificates/[attemptId]/route'

const mockAuth = auth as jest.MockedFunction<typeof auth>

function makeSession(role: string, id = 'user-1') {
  return { user: { id, name: 'Test', email: 'test@test.com', role } }
}

const attemptId = 'c' + 'a'.repeat(24)
const routeCtx = { params: { attemptId } }

function makeRequest(): NextRequest {
  return new NextRequest(`http://localhost/api/certificates/${attemptId}`)
}

const passedAttempt = {
  id: attemptId,
  userId: 'user-1',
  score: 90,
  passed: true,
  completedAt: new Date('2026-01-15'),
  user: {
    firstName: 'Jane',
    lastName: 'Doe',
    preferredFirstName: null,
    preferredLastName: null,
    username: 'jdoe',
  },
  course: { title: 'Safety Training' },
}

describe('GET /api/certificates/[attemptId]', () => {
  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null as never)
    const res = await GET(makeRequest(), routeCtx)
    expect(res.status).toBe(401)
  })

  it('returns 404 when attempt not found', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    ;(prisma.courseAttempt.findUnique as jest.Mock).mockResolvedValueOnce(null)
    const res = await GET(makeRequest(), routeCtx)
    expect(res.status).toBe(404)
  })

  it('returns 403 for failed attempt (passed=false)', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER', 'user-1') as never)
    ;(prisma.courseAttempt.findUnique as jest.Mock).mockResolvedValueOnce({
      ...passedAttempt,
      passed: false,
    })
    const res = await GET(makeRequest(), routeCtx)
    expect(res.status).toBe(403)
  })

  it('returns 403 when a different USER tries to access another user attempt', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER', 'other-user') as never)
    ;(prisma.courseAttempt.findUnique as jest.Mock).mockResolvedValueOnce(passedAttempt)
    const res = await GET(makeRequest(), routeCtx)
    expect(res.status).toBe(403)
  })

  it('returns 200 for own passed attempt', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER', 'user-1') as never)
    ;(prisma.courseAttempt.findUnique as jest.Mock).mockResolvedValueOnce(passedAttempt)
    ;(prisma.brandingSetting.findFirst as jest.Mock).mockResolvedValueOnce({
      orgName: 'Test Corp',
      logoPath: null,
    })
    const res = await GET(makeRequest(), routeCtx)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.displayName).toBe('Jane Doe')
    expect(data.courseName).toBe('Safety Training')
    expect(data.score).toBe(90)
    expect(data.logoUrl).toBeNull()
  })

  it('returns 200 for SUPERVISOR viewing another user attempt', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('SUPERVISOR', 'supervisor-1') as never)
    ;(prisma.courseAttempt.findUnique as jest.Mock).mockResolvedValueOnce(passedAttempt)
    ;(prisma.brandingSetting.findFirst as jest.Mock).mockResolvedValueOnce(null)
    const res = await GET(makeRequest(), routeCtx)
    expect(res.status).toBe(200)
  })

  it('returns 200 for ADMIN viewing another user attempt', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN', 'admin-1') as never)
    ;(prisma.courseAttempt.findUnique as jest.Mock).mockResolvedValueOnce(passedAttempt)
    ;(prisma.brandingSetting.findFirst as jest.Mock).mockResolvedValueOnce(null)
    const res = await GET(makeRequest(), routeCtx)
    expect(res.status).toBe(200)
  })

  it('falls back to username when firstName is null', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER', 'user-1') as never)
    ;(prisma.courseAttempt.findUnique as jest.Mock).mockResolvedValueOnce({
      ...passedAttempt,
      user: { firstName: null, lastName: null, preferredFirstName: null, preferredLastName: null, username: 'jdoe' },
    })
    ;(prisma.brandingSetting.findFirst as jest.Mock).mockResolvedValueOnce(null)
    const res = await GET(makeRequest(), routeCtx)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.displayName).toContain('jdoe')
  })

  it('uses preferredFirstName over firstName when available', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER', 'user-1') as never)
    ;(prisma.courseAttempt.findUnique as jest.Mock).mockResolvedValueOnce({
      ...passedAttempt,
      user: { firstName: 'Jane', lastName: 'Doe', preferredFirstName: 'Jay', preferredLastName: 'D', username: 'jdoe' },
    })
    ;(prisma.brandingSetting.findFirst as jest.Mock).mockResolvedValueOnce(null)
    const res = await GET(makeRequest(), routeCtx)
    const data = await res.json()
    expect(data.displayName).toContain('Jay')
    expect(data.displayName).toContain('D')
  })

  it('includes logoUrl when branding has logoPath', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER', 'user-1') as never)
    ;(prisma.courseAttempt.findUnique as jest.Mock).mockResolvedValueOnce(passedAttempt)
    ;(prisma.brandingSetting.findFirst as jest.Mock).mockResolvedValueOnce({
      orgName: 'Test Corp',
      logoPath: '/uploads/logo.png',
    })
    const res = await GET(makeRequest(), routeCtx)
    const data = await res.json()
    expect(data.logoUrl).toBe('/api/branding/logo')
  })
})
