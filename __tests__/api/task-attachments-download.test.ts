/**
 * Tests for GET /api/attachments/[attachmentId]/download
 *
 * Covers:
 *   - Authentication (no session -> 401)
 *   - Input validation: invalid attachmentId -> 400
 *   - Rate limit exceeded -> 429
 *   - Attachment not found -> 404
 *   - Assigned user (USER role) downloads own attachment -> 200
 *   - USER who is NOT the assigned user -> 403
 *   - SUPERVISOR role downloads any attachment -> 200
 *   - PAYROLL, HR, ADMIN roles -> 200
 *   - storagePath contains / -> 500
 *   - storagePath contains .. -> 500
 *   - readFile throws ENOENT -> 404
 *   - Response has correct security headers
 *   - Rate limit is keyed on the requester id, not the attachment owner id
 */

import { NextRequest } from 'next/server'

// ---- Module mocks ----

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/logger', () => ({ logError: jest.fn(), logAccess: jest.fn(), log: jest.fn() }))
jest.mock('@/lib/db', () => ({
  prisma: {
    taskAttachment: {
      findUnique: jest.fn(),
    },
  },
}))
jest.mock('@/lib/ratelimit', () => ({
  checkAttachmentDownloadRateLimit: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { checkAttachmentDownloadRateLimit } from '@/lib/ratelimit'
import { readFile } from 'fs/promises'
import { GET } from '@/app/api/attachments/[attachmentId]/download/route'

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockFindUnique = prisma.taskAttachment.findUnique as jest.MockedFunction<
  typeof prisma.taskAttachment.findUnique
>
const mockCheckRateLimit = checkAttachmentDownloadRateLimit as jest.MockedFunction<
  typeof checkAttachmentDownloadRateLimit
>
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>

// ---- Helpers ----

const VALID_ATTACHMENT_ID = 'c111111111111111111111111'
const ASSIGNED_USER_ID = 'c222222222222222222222222'
const OTHER_USER_ID = 'c333333333333333333333333'

function makeSession(role: string, id = OTHER_USER_ID) {
  return { user: { id, name: 'Test', email: 'test@test.com', role } }
}

function makeAssignedUserSession() {
  return { user: { id: ASSIGNED_USER_ID, name: 'User', email: 'user@test.com', role: 'USER' } }
}

function makeContext(attachmentId = VALID_ATTACHMENT_ID) {
  return { params: { attachmentId } }
}

function makeRequest(): NextRequest {
  return new NextRequest(
    `http://localhost/api/attachments/${VALID_ATTACHMENT_ID}/download`,
    { method: 'GET' },
  )
}

const MOCK_ATTACHMENT = {
  filename: 'blank_form.pdf',
  storagePath: 'a1b2c3d4-uuid.pdf',
  userTask: { userId: ASSIGNED_USER_ID },
}

const PDF_BUFFER = Buffer.from('%PDF-1.4 fake pdf content')

// ---- Setup ----

beforeEach(() => {
  jest.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(undefined)
  mockFindUnique.mockResolvedValue(MOCK_ATTACHMENT as never)
  mockReadFile.mockResolvedValue(PDF_BUFFER as never)
})

// ---- Tests ----

describe('GET /api/attachments/[attachmentId]/download — authentication', () => {
  it('returns 401 when no session exists', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })
})

describe('GET — input validation', () => {
  it('returns 400 for an invalid attachmentId', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    const res = await GET(makeRequest(), makeContext('not-a-cuid'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/attachmentId/)
  })
})

describe('GET — rate limiting', () => {
  it('returns 429 when rate limit is exceeded', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockCheckRateLimit.mockRejectedValueOnce(new Error('Rate limit exceeded'))
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(429)
  })

  it('keys rate limit on the requesting user id, not the assigned user id', async () => {
    const requesterId = 'c999999999999999999999999'
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN', requesterId) as never)
    await GET(makeRequest(), makeContext())
    expect(mockCheckRateLimit).toHaveBeenCalledWith(requesterId)
    expect(mockCheckRateLimit).not.toHaveBeenCalledWith(ASSIGNED_USER_ID)
  })
})

describe('GET — attachment lookup', () => {
  it('returns 404 when attachment does not exist', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockFindUnique.mockResolvedValueOnce(null)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(404)
  })
})

describe('GET — authorization', () => {
  it('allows the assigned user (USER role) to download their own attachment', async () => {
    mockAuth.mockResolvedValueOnce(makeAssignedUserSession() as never)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(200)
  })

  it('returns 403 when a USER is not the assigned user', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER', OTHER_USER_ID) as never)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Forbidden')
  })

  it('allows SUPERVISOR role to download any attachment', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('SUPERVISOR') as never)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(200)
  })

  it('allows PAYROLL role to download any attachment', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('PAYROLL') as never)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(200)
  })

  it('allows HR role to download any attachment', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(200)
  })

  it('allows ADMIN role to download any attachment', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(200)
  })
})

describe('GET — path traversal guard', () => {
  it('returns 500 when storagePath contains a forward slash', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockFindUnique.mockResolvedValueOnce({
      ...MOCK_ATTACHMENT,
      storagePath: '../etc/passwd',
    } as never)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(500)
  })

  it('returns 500 when storagePath contains double-dot', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockFindUnique.mockResolvedValueOnce({
      ...MOCK_ATTACHMENT,
      storagePath: 'valid-uuid..pdf',
    } as never)
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(500)
  })
})

describe('GET — file read errors', () => {
  it('returns 404 when readFile throws ENOENT', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockReadFile.mockRejectedValueOnce(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    )
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('File not found')
  })
})

describe('GET — success response', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
  })

  it('returns 200 with file content', async () => {
    const res = await GET(makeRequest(), makeContext())
    expect(res.status).toBe(200)
    const body = Buffer.from(await res.arrayBuffer())
    expect(body).toEqual(PDF_BUFFER)
  })

  it('sets Content-Type to application/pdf for .pdf files', async () => {
    const res = await GET(makeRequest(), makeContext())
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
  })

  it('sets Content-Disposition as attachment with original filename', async () => {
    const res = await GET(makeRequest(), makeContext())
    const cd = res.headers.get('Content-Disposition')
    expect(cd).toMatch(/attachment/)
    expect(cd).toMatch(/blank_form\.pdf/)
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
})
