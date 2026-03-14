/**
 * Tests for POST /api/users/[userId]/tasks/[taskId]/attachments
 *
 * Covers:
 *   - Authentication (no session -> 401)
 *   - Authorization: USER role -> 403, PAYROLL role -> 403, HR+ allowed
 *   - Rate limit exceeded -> 429
 *   - Input validation: invalid userId/taskId -> 400
 *   - Target user not found -> 404
 *   - Target user inactive -> 409
 *   - UserTask not assigned -> 404
 *   - Missing file field -> 400
 *   - saveUpload throws UploadError 415 / 413 -> propagated
 *   - DB transaction fails -> 500
 *   - HR role, valid file, valid assignment -> 201 { id, filename, uploadedAt }
 *   - ADMIN role -> 201
 */

import { NextRequest } from 'next/server'

// ---- Module mocks ----

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    userTask: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}))
jest.mock('@/lib/ratelimit', () => ({
  checkAttachmentUploadRateLimit: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/upload', () => ({
  saveUpload: jest.fn(),
  UploadError: class UploadError extends Error {
    statusCode: number
    constructor(message: string, statusCode: number) {
      super(message)
      this.statusCode = statusCode
    }
  },
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { checkAttachmentUploadRateLimit } from '@/lib/ratelimit'
import { saveUpload, UploadError } from '@/lib/upload'
import { POST } from '@/app/api/users/[userId]/tasks/[taskId]/attachments/route'

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockUserFindUnique = prisma.user.findUnique as jest.MockedFunction<
  typeof prisma.user.findUnique
>
const mockUserTaskFindUnique = prisma.userTask.findUnique as jest.MockedFunction<
  typeof prisma.userTask.findUnique
>
const mockTransaction = prisma.$transaction as jest.MockedFunction<
  typeof prisma.$transaction
>
const mockSaveUpload = saveUpload as jest.MockedFunction<typeof saveUpload>
const mockCheckRateLimit = checkAttachmentUploadRateLimit as jest.MockedFunction<
  typeof checkAttachmentUploadRateLimit
>

// ---- Helpers ----

const VALID_USER_ID = 'c111111111111111111111111'
const VALID_TASK_ID = 'c222222222222222222222222'
const UPLOADER_ID = 'c333333333333333333333333'

function makeSession(role: string, id = UPLOADER_ID) {
  return { user: { id, name: 'HR User', email: 'hr@test.com', role } }
}

function makeContext(userId = VALID_USER_ID, taskId = VALID_TASK_ID) {
  return { params: { userId, taskId } }
}

async function makeRequest(file?: File): Promise<NextRequest> {
  const formData = new FormData()
  if (file) formData.append('file', file)
  return new NextRequest(
    `http://localhost/api/users/${VALID_USER_ID}/tasks/${VALID_TASK_ID}/attachments`,
    { method: 'POST', body: formData },
  )
}

function makeFile(name = 'form.pdf', type = 'application/pdf', size = 1024): File {
  return new File([new Uint8Array(size).fill(0)], name, { type })
}

const ACTIVE_USER = { id: VALID_USER_ID, active: true }
const INACTIVE_USER = { id: VALID_USER_ID, active: false }
const MOCK_USER_TASK = { id: 'c444444444444444444444444' }

// ---- Setup ----

beforeEach(() => {
  jest.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(undefined)
  mockUserFindUnique.mockResolvedValue(ACTIVE_USER as never)
  mockUserTaskFindUnique.mockResolvedValue(MOCK_USER_TASK as never)
  mockSaveUpload.mockResolvedValue({ storagePath: 'uuid.pdf', filename: 'form.pdf' })
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn({
      taskAttachment: {
        create: jest.fn().mockResolvedValue({
          id: 'c555555555555555555555555',
          filename: 'form.pdf',
          uploadedAt: new Date('2026-03-13T00:00:00Z'),
        }),
      },
    })
  })
})

// ---- Tests ----

describe('POST /api/users/[userId]/tasks/[taskId]/attachments — authentication', () => {
  it('returns 401 when no session exists', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await POST(await makeRequest(), makeContext())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })
})

describe('POST — authorization', () => {
  it('returns 403 for USER role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    const res = await POST(await makeRequest(makeFile()), makeContext())
    expect(res.status).toBe(403)
  })

  it('returns 403 for PAYROLL role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('PAYROLL') as never)
    const res = await POST(await makeRequest(makeFile()), makeContext())
    expect(res.status).toBe(403)
  })
})

describe('POST — rate limiting', () => {
  it('returns 429 when rate limit is exceeded', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockCheckRateLimit.mockRejectedValueOnce(new Error('Rate limit'))
    const res = await POST(await makeRequest(makeFile()), makeContext())
    expect(res.status).toBe(429)
  })
})

describe('POST — input validation', () => {
  it('returns 400 for invalid userId', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await POST(await makeRequest(makeFile()), makeContext('not-a-cuid'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/userId/)
  })

  it('returns 400 for invalid taskId', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await POST(await makeRequest(makeFile()), makeContext(VALID_USER_ID, 'bad'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/taskId/)
  })
})

describe('POST — target user checks', () => {
  it('returns 404 when target user does not exist', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockUserFindUnique.mockResolvedValueOnce(null)
    const res = await POST(await makeRequest(makeFile()), makeContext())
    expect(res.status).toBe(404)
  })

  it('returns 409 when target user is inactive', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockUserFindUnique.mockResolvedValueOnce(INACTIVE_USER as never)
    const res = await POST(await makeRequest(makeFile()), makeContext())
    expect(res.status).toBe(409)
  })
})

describe('POST — task assignment checks', () => {
  it('returns 404 when task is not assigned to the user', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockUserTaskFindUnique.mockResolvedValueOnce(null)
    const res = await POST(await makeRequest(makeFile()), makeContext())
    expect(res.status).toBe(404)
  })
})

describe('POST — file validation', () => {
  it('returns 400 when file field is missing', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await POST(await makeRequest(), makeContext())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/file/)
  })

  it('propagates UploadError 415 from saveUpload', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockSaveUpload.mockRejectedValueOnce(new UploadError('File type not allowed', 415))
    const res = await POST(await makeRequest(makeFile('bad.exe')), makeContext())
    expect(res.status).toBe(415)
  })

  it('propagates UploadError 413 from saveUpload', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockSaveUpload.mockRejectedValueOnce(new UploadError('File exceeds maximum size of 25 MB', 413))
    const res = await POST(await makeRequest(makeFile()), makeContext())
    expect(res.status).toBe(413)
  })
})

describe('POST — DB errors', () => {
  it('returns 500 when DB transaction fails', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockTransaction.mockRejectedValueOnce(new Error('DB error'))
    const res = await POST(await makeRequest(makeFile()), makeContext())
    expect(res.status).toBe(500)
  })
})

describe('POST — success', () => {
  it('returns 201 with id, filename, uploadedAt for HR role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await POST(await makeRequest(makeFile()), makeContext())
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBeDefined()
    expect(body.filename).toBe('form.pdf')
    expect(body.uploadedAt).toBeDefined()
  })

  it('returns 201 for ADMIN role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    const res = await POST(await makeRequest(makeFile()), makeContext())
    expect(res.status).toBe(201)
  })
})
