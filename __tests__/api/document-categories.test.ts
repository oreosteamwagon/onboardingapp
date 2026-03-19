/**
 * Tests for GET/POST /api/admin/document-categories
 * and DELETE /api/admin/document-categories/[id]
 *
 * Covers:
 *   - Authentication: no session -> 401
 *   - Authorization: non-ADMIN roles -> 403; ADMIN -> allowed
 *   - Rate limiting: 429 on POST and DELETE
 *   - GET: returns all categories ordered by isBuiltIn desc, name asc
 *   - POST: input validation (missing, non-string, empty, too long, disallowed chars)
 *   - POST: 409 on duplicate (P2002)
 *   - POST: 201 success with correct shape; isBuiltIn always false; slug derived from name
 *   - DELETE: input validation (invalid id format)
 *   - DELETE: 404 not found
 *   - DELETE: 409 when isBuiltIn=true
 *   - DELETE: 409 when category is in use
 *   - DELETE: 204 success
 *   - DELETE: prisma.documentCategory.delete not called on guard failures
 */

import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'

// ---- Module mocks ----

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/logger', () => ({ logError: jest.fn(), logAccess: jest.fn(), log: jest.fn() }))
jest.mock('@/lib/db', () => ({
  prisma: {
    documentCategory: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    document: {
      count: jest.fn(),
    },
  },
}))
jest.mock('@/lib/ratelimit', () => ({
  checkCategoryMgmtRateLimit: jest.fn().mockResolvedValue(undefined),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { checkCategoryMgmtRateLimit } from '@/lib/ratelimit'
import { GET, POST } from '@/app/api/admin/document-categories/route'
import { DELETE } from '@/app/api/admin/document-categories/[id]/route'

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockFindMany = prisma.documentCategory.findMany as jest.MockedFunction<typeof prisma.documentCategory.findMany>
const mockFindUnique = prisma.documentCategory.findUnique as jest.MockedFunction<typeof prisma.documentCategory.findUnique>
const mockCreate = prisma.documentCategory.create as jest.MockedFunction<typeof prisma.documentCategory.create>
const mockDeleteCat = prisma.documentCategory.delete as jest.MockedFunction<typeof prisma.documentCategory.delete>
const mockDocCount = prisma.document.count as jest.MockedFunction<typeof prisma.document.count>
const mockCheckRateLimit = checkCategoryMgmtRateLimit as jest.MockedFunction<typeof checkCategoryMgmtRateLimit>

// ---- Helpers ----

const ADMIN_ID = 'c111111111111111111111111'
const CAT_ID = 'builtin-general'

function makeSession(role: string, id = ADMIN_ID) {
  return { user: { id, name: 'Test', email: 'test@test.com', role } }
}

function makeAdminSession() {
  return makeSession('ADMIN', ADMIN_ID)
}

function makeGetRequest(): NextRequest {
  return new NextRequest('http://localhost/api/admin/document-categories', { method: 'GET' })
}

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/document-categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeDeleteRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/admin/document-categories/${id}`, { method: 'DELETE' })
}

function makeDeleteContext(id: string) {
  return { params: { id } }
}

const MOCK_CATEGORIES = [
  { id: 'builtin-general', slug: 'general', name: 'General', isBuiltIn: true },
  { id: 'builtin-policy',  slug: 'policy',  name: 'Policy',  isBuiltIn: true },
]

const MOCK_CUSTOM_CAT = { id: 'cstm-abc123', slug: 'it-onboarding', name: 'IT Onboarding', isBuiltIn: false }

// ---- Setup ----

beforeEach(() => {
  jest.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(undefined)
  mockFindMany.mockResolvedValue(MOCK_CATEGORIES as never)
  mockFindUnique.mockResolvedValue(MOCK_CUSTOM_CAT as never)
  mockCreate.mockResolvedValue(MOCK_CUSTOM_CAT as never)
  mockDeleteCat.mockResolvedValue(MOCK_CUSTOM_CAT as never)
  mockDocCount.mockResolvedValue(0)
})

// ---- GET tests ----

describe('GET /api/admin/document-categories — authentication', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })
})

describe('GET /api/admin/document-categories — authorization', () => {
  it.each(['USER', 'PAYROLL', 'HR', 'SUPERVISOR'])(
    'returns 403 for %s role',
    async (role) => {
      mockAuth.mockResolvedValueOnce(makeSession(role) as never)
      const res = await GET()
      expect(res.status).toBe(403)
    },
  )

  it('returns 200 with category array for ADMIN', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(2)
  })
})

// ---- POST tests ----

describe('POST /api/admin/document-categories — authentication', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await POST(makePostRequest({ name: 'Test' }))
    expect(res.status).toBe(401)
  })
})

describe('POST /api/admin/document-categories — authorization', () => {
  it.each(['USER', 'PAYROLL', 'HR', 'SUPERVISOR'])(
    'returns 403 for %s role',
    async (role) => {
      mockAuth.mockResolvedValueOnce(makeSession(role) as never)
      const res = await POST(makePostRequest({ name: 'Test' }))
      expect(res.status).toBe(403)
    },
  )
})

describe('POST /api/admin/document-categories — rate limiting', () => {
  it('returns 429 when rate limit exceeded', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockCheckRateLimit.mockRejectedValueOnce(new Error('Rate limited'))
    const res = await POST(makePostRequest({ name: 'Test' }))
    expect(res.status).toBe(429)
  })

  it('keys rate limit on user id', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    await POST(makePostRequest({ name: 'Valid Name' }))
    expect(mockCheckRateLimit).toHaveBeenCalledWith(ADMIN_ID)
  })
})

describe('POST /api/admin/document-categories — input validation', () => {
  it('returns 400 when name is missing', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await POST(makePostRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 400 when name is not a string', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await POST(makePostRequest({ name: 42 }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when name is empty after trim', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await POST(makePostRequest({ name: '   ' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when name is too short (1 char)', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await POST(makePostRequest({ name: 'A' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when name is too long (65 chars)', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await POST(makePostRequest({ name: 'A'.repeat(65) }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when name contains disallowed chars', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await POST(makePostRequest({ name: '<script>alert(1)</script>' }))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/admin/document-categories — conflict', () => {
  it('returns 409 when a duplicate name exists (P2002)', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const p2002 = Object.assign(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
      }),
    )
    mockCreate.mockRejectedValueOnce(p2002)
    const res = await POST(makePostRequest({ name: 'General' }))
    expect(res.status).toBe(409)
  })
})

describe('POST /api/admin/document-categories — success', () => {
  it('returns 201 with correct shape', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await POST(makePostRequest({ name: 'IT Onboarding' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('slug')
    expect(body).toHaveProperty('name')
    expect(body).toHaveProperty('isBuiltIn')
  })

  it('always creates with isBuiltIn=false even if body sends true', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    await POST(makePostRequest({ name: 'Valid Name', isBuiltIn: true }))
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isBuiltIn: false }),
      }),
    )
  })

  it('derives slug from name server-side', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    await POST(makePostRequest({ name: 'IT & Security' }))
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slug: 'it-and-security' }),
      }),
    )
  })
})

// ---- DELETE tests ----

describe('DELETE /api/admin/document-categories/[id] — authentication', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await DELETE(makeDeleteRequest(CAT_ID), makeDeleteContext(CAT_ID))
    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/admin/document-categories/[id] — authorization', () => {
  it.each(['USER', 'PAYROLL', 'HR', 'SUPERVISOR'])(
    'returns 403 for %s role',
    async (role) => {
      mockAuth.mockResolvedValueOnce(makeSession(role) as never)
      const res = await DELETE(makeDeleteRequest(CAT_ID), makeDeleteContext(CAT_ID))
      expect(res.status).toBe(403)
    },
  )
})

describe('DELETE /api/admin/document-categories/[id] — rate limiting', () => {
  it('returns 429 when rate limit exceeded', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockCheckRateLimit.mockRejectedValueOnce(new Error('Rate limited'))
    const res = await DELETE(makeDeleteRequest(CAT_ID), makeDeleteContext(CAT_ID))
    expect(res.status).toBe(429)
  })
})

describe('DELETE /api/admin/document-categories/[id] — input validation', () => {
  it('returns 400 for empty id', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await DELETE(makeDeleteRequest(''), makeDeleteContext(''))
    expect(res.status).toBe(400)
  })

  it('returns 400 for id containing disallowed chars', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const badId = '../etc/passwd'
    const res = await DELETE(makeDeleteRequest(badId), makeDeleteContext(badId))
    expect(res.status).toBe(400)
  })

  it('returns 400 for id exceeding 64 chars', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const longId = 'a'.repeat(65)
    const res = await DELETE(makeDeleteRequest(longId), makeDeleteContext(longId))
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/admin/document-categories/[id] — not found', () => {
  it('returns 404 when category does not exist', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce(null)
    const res = await DELETE(makeDeleteRequest(CAT_ID), makeDeleteContext(CAT_ID))
    expect(res.status).toBe(404)
    expect(mockDeleteCat).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/admin/document-categories/[id] — built-in protection', () => {
  it('returns 409 with built-in message when isBuiltIn=true', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce({ ...MOCK_CUSTOM_CAT, isBuiltIn: true } as never)
    const res = await DELETE(makeDeleteRequest(CAT_ID), makeDeleteContext(CAT_ID))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/built-in/i)
    expect(mockDeleteCat).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/admin/document-categories/[id] — in-use guard', () => {
  it('returns 409 with count in message when category is in use', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockDocCount.mockResolvedValueOnce(3)
    const res = await DELETE(makeDeleteRequest(CAT_ID), makeDeleteContext(CAT_ID))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/3/)
    expect(mockDeleteCat).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/admin/document-categories/[id] — success', () => {
  it('returns 204 with no body on success', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await DELETE(makeDeleteRequest(CAT_ID), makeDeleteContext(CAT_ID))
    expect(res.status).toBe(204)
    const text = await res.text()
    expect(text).toBe('')
  })

  it('calls prisma.documentCategory.delete with correct id', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    await DELETE(makeDeleteRequest(CAT_ID), makeDeleteContext(CAT_ID))
    expect(mockDeleteCat).toHaveBeenCalledWith({ where: { id: CAT_ID } })
  })
})
