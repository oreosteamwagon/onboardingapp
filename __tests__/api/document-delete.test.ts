/**
 * Tests for DELETE /api/documents/[documentId]
 *
 * Covers:
 *   - Authentication: no session -> 401
 *   - Authorization: USER/PAYROLL/HR/SUPERVISOR -> 403; ADMIN -> allowed
 *   - Rate limit exceeded -> 429
 *   - Input validation: invalid documentId format -> 400
 *   - Document not found -> 404
 *   - Suspicious storagePath (path traversal chars) -> 500
 *   - Filesystem error (non-ENOENT) -> 500; DB delete NOT called
 *   - File already gone (ENOENT) -> still succeeds, DB delete called
 *   - Success: 204, unlink and prisma.document.delete both called with correct args
 */

import { NextRequest } from 'next/server'

// ---- Module mocks ----

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/db', () => ({
  prisma: {
    document: {
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  },
}))
jest.mock('@/lib/ratelimit', () => ({
  checkDocumentDeleteRateLimit: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('fs/promises', () => ({
  unlink: jest.fn().mockResolvedValue(undefined),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { checkDocumentDeleteRateLimit } from '@/lib/ratelimit'
import { unlink } from 'fs/promises'
import { DELETE } from '@/app/api/documents/[documentId]/route'

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockFindUnique = prisma.document.findUnique as jest.MockedFunction<
  typeof prisma.document.findUnique
>
const mockDelete = prisma.document.delete as jest.MockedFunction<
  typeof prisma.document.delete
>
const mockCheckRateLimit = checkDocumentDeleteRateLimit as jest.MockedFunction<
  typeof checkDocumentDeleteRateLimit
>
const mockUnlink = unlink as jest.MockedFunction<typeof unlink>

// ---- Helpers ----

const VALID_DOC_ID = 'c111111111111111111111111'
const ADMIN_ID = 'c222222222222222222222222'

function makeSession(role: string, id = ADMIN_ID) {
  return { user: { id, name: 'Test', email: 'test@test.com', role } }
}

function makeAdminSession() {
  return makeSession('ADMIN', ADMIN_ID)
}

function makeContext(documentId = VALID_DOC_ID) {
  return { params: { documentId } }
}

function makeRequest(documentId = VALID_DOC_ID): NextRequest {
  return new NextRequest(`http://localhost/api/documents/${documentId}`, {
    method: 'DELETE',
  })
}

const MOCK_DOCUMENT = {
  id: VALID_DOC_ID,
  storagePath: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890.pdf',
  filename: 'policy.pdf',
}

// ---- Setup ----

beforeEach(() => {
  jest.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(undefined)
  mockFindUnique.mockResolvedValue(MOCK_DOCUMENT as never)
  mockDelete.mockResolvedValue(MOCK_DOCUMENT as never)
  mockUnlink.mockResolvedValue(undefined)
})

// ---- Tests ----

describe('DELETE /api/documents/[documentId] — authentication', () => {
  it('returns 401 when no session exists', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await DELETE(makeRequest(), makeContext())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })
})

describe('DELETE /api/documents/[documentId] — authorization', () => {
  it.each(['USER', 'PAYROLL', 'HR', 'SUPERVISOR'])(
    'returns 403 for %s role',
    async (role) => {
      mockAuth.mockResolvedValueOnce(makeSession(role) as never)
      const res = await DELETE(makeRequest(), makeContext())
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toMatch(/admin/i)
    },
  )

  it('allows ADMIN role to proceed', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await DELETE(makeRequest(), makeContext())
    expect(res.status).toBe(204)
  })
})

describe('DELETE /api/documents/[documentId] — rate limiting', () => {
  it('returns 429 when rate limit is exceeded', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockCheckRateLimit.mockRejectedValueOnce(new Error('Rate limit exceeded'))
    const res = await DELETE(makeRequest(), makeContext())
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('Too many requests')
  })

  it('keys the rate limit on the requesting user id', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    await DELETE(makeRequest(), makeContext())
    expect(mockCheckRateLimit).toHaveBeenCalledWith(ADMIN_ID)
  })
})

describe('DELETE /api/documents/[documentId] — input validation', () => {
  it('returns 400 for an invalid documentId (not a CUID)', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await DELETE(makeRequest('not-a-cuid'), makeContext('not-a-cuid'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/documentId/)
  })

  it('returns 400 for an empty string documentId', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await DELETE(makeRequest(''), makeContext(''))
    expect(res.status).toBe(400)
  })

  it('returns 400 for a numeric string documentId', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await DELETE(makeRequest('12345'), makeContext('12345'))
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/documents/[documentId] — document lookup', () => {
  it('returns 404 when the document does not exist', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce(null)
    const res = await DELETE(makeRequest(), makeContext())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Document not found')
  })

  it('does not call unlink or delete when the document is not found', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce(null)
    await DELETE(makeRequest(), makeContext())
    expect(mockUnlink).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/documents/[documentId] — path traversal guard', () => {
  it('returns 500 when storagePath contains a forward slash', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce({
      ...MOCK_DOCUMENT,
      storagePath: '../etc/passwd',
    } as never)
    const res = await DELETE(makeRequest(), makeContext())
    expect(res.status).toBe(500)
    expect(mockUnlink).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('returns 500 when storagePath contains a backslash', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce({
      ...MOCK_DOCUMENT,
      storagePath: '..\\etc\\passwd',
    } as never)
    const res = await DELETE(makeRequest(), makeContext())
    expect(res.status).toBe(500)
  })

  it('returns 500 when storagePath contains double-dot', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce({
      ...MOCK_DOCUMENT,
      storagePath: 'valid-uuid..pdf',
    } as never)
    const res = await DELETE(makeRequest(), makeContext())
    expect(res.status).toBe(500)
  })
})

describe('DELETE /api/documents/[documentId] — filesystem errors', () => {
  it('returns 500 and does NOT delete DB record when unlink fails with a non-ENOENT error', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockUnlink.mockRejectedValueOnce(
      Object.assign(new Error('EACCES'), { code: 'EACCES' }),
    )
    const res = await DELETE(makeRequest(), makeContext())
    expect(res.status).toBe(500)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('returns 204 and still deletes DB record when unlink throws ENOENT (file already gone)', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockUnlink.mockRejectedValueOnce(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    )
    const res = await DELETE(makeRequest(), makeContext())
    expect(res.status).toBe(204)
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: VALID_DOC_ID } })
  })
})

describe('DELETE /api/documents/[documentId] — success', () => {
  it('returns 204 with no body on success', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await DELETE(makeRequest(), makeContext())
    expect(res.status).toBe(204)
    const text = await res.text()
    expect(text).toBe('')
  })

  it('calls unlink with the correct file path', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    await DELETE(makeRequest(), makeContext())
    expect(mockUnlink).toHaveBeenCalledWith(
      expect.stringContaining(MOCK_DOCUMENT.storagePath),
    )
  })

  it('calls prisma.document.delete with the correct document id', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    await DELETE(makeRequest(), makeContext())
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: VALID_DOC_ID } })
  })

  it('calls unlink before prisma.document.delete', async () => {
    const callOrder: string[] = []
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockUnlink.mockImplementationOnce(async () => { callOrder.push('unlink') })
    mockDelete.mockImplementationOnce(async () => { callOrder.push('delete'); return MOCK_DOCUMENT as never })
    await DELETE(makeRequest(), makeContext())
    expect(callOrder).toEqual(['unlink', 'delete'])
  })
})
