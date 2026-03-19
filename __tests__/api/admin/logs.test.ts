/**
 * Tests for GET /api/admin/logs
 *
 * Covers:
 *   - Authentication: no session -> 401
 *   - Authorization: USER/HR/SUPERVISOR -> 403; ADMIN -> 200
 *   - Rate limit exceeded -> 429
 *   - Query param validation: level, from, to, page, limit
 *   - Prisma query construction: where clause, orderBy, skip
 *   - Response shape: { logs, total, page, totalPages }
 */

import { NextRequest } from 'next/server'

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))

const mockFindMany = jest.fn()
const mockCount = jest.fn()
const mockCheckLogReadRateLimit = jest.fn()

jest.mock('@/lib/db', () => ({
  prisma: {
    appLog: {
      findMany: mockFindMany,
      count: mockCount,
    },
  },
}))

jest.mock('@/lib/ratelimit', () => ({
  checkLogReadRateLimit: mockCheckLogReadRateLimit,
}))

import { auth } from '@/lib/auth'
import { GET } from '@/app/api/admin/logs/route'

const mockAuth = auth as jest.MockedFunction<typeof auth>

function makeSession(role: string, id = 'admin-id') {
  return { user: { id, name: 'Admin', email: 'admin@test.com', role } }
}

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost/api/admin/logs')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

const SAMPLE_LOG = {
  id: 'clog1234567890123456789012',
  level: 'ERROR' as const,
  message: '[ERROR] something failed',
  userId: null,
  action: 'test_action',
  path: '/api/test',
  statusCode: 500,
  meta: {},
  createdAt: new Date('2026-03-18T10:00:00Z'),
}

beforeEach(() => {
  mockAuth.mockResolvedValue(null)
  mockFindMany.mockResolvedValue([])
  mockCount.mockResolvedValue(0)
  mockCheckLogReadRateLimit.mockResolvedValue(undefined)
})

describe('GET /api/admin/logs — authentication', () => {
  it('returns 401 when no session exists', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })
})

describe('GET /api/admin/logs — authorization', () => {
  it('returns 403 for USER role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
  })

  it('returns 403 for HR role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
  })

  it('returns 403 for SUPERVISOR role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('SUPERVISOR') as never)
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
  })

  it('returns 200 for ADMIN role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
  })
})

describe('GET /api/admin/logs — rate limiting', () => {
  it('returns 429 when rate limit is exceeded', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockCheckLogReadRateLimit.mockRejectedValueOnce(new Error('rate limit'))
    const res = await GET(makeRequest())
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('Too many requests')
  })
})

describe('GET /api/admin/logs — query param validation', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession('ADMIN') as never)
  })

  it('returns 400 for invalid level value', async () => {
    const res = await GET(makeRequest({ level: 'WARN' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/level/i)
  })

  it('returns 400 for invalid from date', async () => {
    const res = await GET(makeRequest({ from: 'notadate' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/from/i)
  })

  it('returns 400 for invalid to date', async () => {
    const res = await GET(makeRequest({ to: 'tomorrow' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/to/i)
  })

  it('returns 400 for page=0', async () => {
    const res = await GET(makeRequest({ page: '0' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for page=-1', async () => {
    const res = await GET(makeRequest({ page: '-1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for page=abc', async () => {
    const res = await GET(makeRequest({ page: 'abc' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for limit=51', async () => {
    const res = await GET(makeRequest({ limit: '51' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for limit=0', async () => {
    const res = await GET(makeRequest({ limit: '0' }))
    expect(res.status).toBe(400)
  })

  it('absent page and limit default to page=1 and limit=50', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.page).toBe(1)
    // findMany should have been called with take=50
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50, skip: 0 }),
    )
  })
})

describe('GET /api/admin/logs — Prisma query construction', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession('ADMIN') as never)
  })

  it('valid level=ERROR is passed to where.level', async () => {
    await GET(makeRequest({ level: 'ERROR' }))
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ level: 'ERROR' }) }),
    )
  })

  it('valid from produces where.createdAt.gte', async () => {
    await GET(makeRequest({ from: '2026-03-01T00:00:00Z' }))
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: expect.objectContaining({ gte: new Date('2026-03-01T00:00:00Z') }),
        }),
      }),
    )
  })

  it('valid to produces where.createdAt.lte', async () => {
    await GET(makeRequest({ to: '2026-03-31T23:59:59Z' }))
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: expect.objectContaining({ lte: new Date('2026-03-31T23:59:59Z') }),
        }),
      }),
    )
  })

  it('findMany is called with orderBy: { createdAt: desc }', async () => {
    await GET(makeRequest())
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    )
  })

  it('page 2 with limit 50 produces skip=50', async () => {
    await GET(makeRequest({ page: '2' }))
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 50, take: 50 }),
    )
  })
})

describe('GET /api/admin/logs — response shape', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession('ADMIN') as never)
  })

  it('returns { logs, total, page, totalPages }', async () => {
    mockFindMany.mockResolvedValueOnce([SAMPLE_LOG])
    mockCount.mockResolvedValueOnce(75)

    const res = await GET(makeRequest({ limit: '50' }))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(Array.isArray(body.logs)).toBe(true)
    expect(body.logs).toHaveLength(1)
    expect(body.total).toBe(75)
    expect(body.page).toBe(1)
    expect(body.totalPages).toBe(2) // Math.ceil(75/50)
  })

  it('log entry createdAt is serialized as ISO string', async () => {
    mockFindMany.mockResolvedValueOnce([SAMPLE_LOG])
    mockCount.mockResolvedValueOnce(1)

    const res = await GET(makeRequest())
    const body = await res.json()
    expect(typeof body.logs[0].createdAt).toBe('string')
    expect(body.logs[0].createdAt).toBe('2026-03-18T10:00:00.000Z')
  })
})
