/**
 * Tests for GET /api/documents/[documentId]/download
 *
 * Covers:
 *   - Authentication: no session -> 401
 *   - Input validation: invalid documentId format -> 400
 *   - Rate limit exceeded -> 429
 *   - Document not found -> 404
 *   - Authorization: uploader (any role) can download their own file
 *   - Authorization: PAYROLL/HR/SUPERVISOR/ADMIN can download any file
 *   - Authorization: USER who is NOT the uploader -> 403
 *   - File not found on disk -> 404
 *   - Suspicious storagePath (path traversal chars) -> 500
 *   - Success: correct Content-Type, Content-Disposition, Cache-Control headers
 */

import { NextRequest } from 'next/server'

// ---- Module mocks ----

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/db', () => ({
  prisma: {
    document: {
      findUnique: jest.fn(),
    },
  },
}))
jest.mock('@/lib/ratelimit', () => ({
  checkDocumentDownloadRateLimit: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { checkDocumentDownloadRateLimit } from '@/lib/ratelimit'
import { readFile } from 'fs/promises'
import { GET } from '@/app/api/documents/[documentId]/download/route'

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockDocumentFindUnique = prisma.document.findUnique as jest.MockedFunction<
  typeof prisma.document.findUnique
>
const mockCheckRateLimit = checkDocumentDownloadRateLimit as jest.MockedFunction<
  typeof checkDocumentDownloadRateLimit
>
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>

// ---- Helpers ----

const VALID_DOC_ID = 'c111111111111111111111111'
const UPLOADER_ID = 'c222222222222222222222222'
const OTHER_USER_ID = 'c333333333333333333333333'

function makeSession(role: string, id = OTHER_USER_ID) {
  return { user: { id, name: 'Test', email: 'test@test.com', role } }
}

function makeUploaderSession() {
  return { user: { id: UPLOADER_ID, name: 'Uploader', email: 'up@test.com', role: 'USER' } }
}

function makeRequest(): NextRequest {
  return new NextRequest(
    `http://localhost/api/documents/${VALID_DOC_ID}/download`,
    { method: 'GET' },
  )
}

function makeContext(documentId = VALID_DOC_ID) {
  return { params: { documentId } }
}

const MOCK_DOCUMENT = {
  id: VALID_DOC_ID,
  uploadedBy: UPLOADER_ID,
  filename: 'my_form.pdf',
  storagePath: 'a1b2c3d4-uuid.pdf',
}

const PDF_BUFFER = Buffer.from('%PDF-1.4 fake pdf content')

// ---- Setup ----

beforeEach(() => {
  jest.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(undefined)
  mockReadFile.mockResolvedValue(PDF_BUFFER as never)
  mockDocumentFindUnique.mockResolvedValue(MOCK_DOCUMENT as never)
})

// ---- Tests ----

describe('GET /api/documents/[documentId]/download — authentication', () => {
  it('returns 401 when no session exists', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })
})

describe('GET /api/documents/[documentId]/download — input validation', () => {
  it('returns 400 for an invalid documentId (not a CUID)', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    const res = await GET(makeRequest(), makeContext('not-a-cuid'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/documentId/)
  })

  it('returns 400 for an empty string documentId', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    const res = await GET(makeRequest(), makeContext(''))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/documents/[documentId]/download — rate limiting', () => {
  it('returns 429 when rate limit is exceeded', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockCheckRateLimit.mockRejectedValueOnce(new Error('Rate limit exceeded'))
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('Too many requests')
  })

  it('keys rate limit on the requesting user id', async () => {
    const userId = 'c444444444444444444444444'
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN', userId) as never)
    await GET(makeRequest(), makeContext())
    expect(mockCheckRateLimit).toHaveBeenCalledWith(userId)
  })
})

describe('GET /api/documents/[documentId]/download — document lookup', () => {
  it('returns 404 when document does not exist', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockDocumentFindUnique.mockResolvedValueOnce(null)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Document not found')
  })
})

describe('GET /api/documents/[documentId]/download — authorization', () => {
  it('allows the uploader (USER role) to download their own file', async () => {
    mockAuth.mockResolvedValueOnce(makeUploaderSession() as never)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(200)
  })

  it('returns 403 when a USER is not the uploader', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER', OTHER_USER_ID) as never)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Forbidden')
  })

  it('allows PAYROLL role to download any document', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('PAYROLL') as never)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(200)
  })

  it('allows HR role to download any document', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(200)
  })

  it('allows SUPERVISOR role to download any document (for approval review)', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('SUPERVISOR') as never)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(200)
  })

  it('allows ADMIN role to download any document', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(200)
  })
})

describe('GET /api/documents/[documentId]/download — file read', () => {
  it('returns 404 when the file does not exist on disk', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('File not found')
  })

  it('returns 500 when storagePath contains a path separator', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockDocumentFindUnique.mockResolvedValueOnce({
      ...MOCK_DOCUMENT,
      storagePath: '../etc/passwd',
    } as never)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(500)
  })

  it('returns 500 when storagePath contains double-dot', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockDocumentFindUnique.mockResolvedValueOnce({
      ...MOCK_DOCUMENT,
      storagePath: 'valid-uuid..pdf',
    } as never)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(500)
  })
})

describe('GET /api/documents/[documentId]/download — success response', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
  })

  it('returns 200 with the file buffer as body', async () => {
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(200)
    const body = Buffer.from(await res.arrayBuffer())
    expect(body).toEqual(PDF_BUFFER)
  })

  it('sets Content-Type to application/pdf for .pdf files', async () => {
    const res = await GET(makeRequest(), makeContext())
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
  })

  it('sets Content-Disposition as attachment with the original filename', async () => {
    const res = await GET(makeRequest(), makeContext())
    const cd = res.headers.get('Content-Disposition')
    expect(cd).toMatch(/attachment/)
    expect(cd).toMatch(/my_form\.pdf/)
  })

  it('sets Cache-Control to no-store', async () => {
    const res = await GET(makeRequest(), makeContext())
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('sets X-Content-Type-Options to nosniff', async () => {
    const res = await GET(makeRequest(), makeContext())
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('sets Content-Length matching the buffer size', async () => {
    const res = await GET(makeRequest(), makeContext())
    expect(res.headers.get('Content-Length')).toBe(String(PDF_BUFFER.length))
  })

  it('uses application/octet-stream for an unrecognised extension', async () => {
    mockDocumentFindUnique.mockResolvedValueOnce({
      ...MOCK_DOCUMENT,
      storagePath: 'somefile.xyz',
    } as never)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
  })
})
