/**
 * Tests for DELETE /api/users/[userId]/tasks/[taskId]/attachments/[attachmentId]
 *
 * Covers:
 *   - Authentication (no session -> 401)
 *   - Authorization: USER role -> 403; HR+ allowed
 *   - Rate limit exceeded -> 429
 *   - Input validation: invalid attachmentId -> 400
 *   - Attachment not found -> 404
 *   - IDOR: userTask.userId mismatch -> 404
 *   - IDOR: userTask.taskId mismatch -> 404
 *   - Suspicious storagePath (contains ..) -> 500
 *   - Successful delete -> 204; verifies prisma.taskAttachment.delete called
 *   - unlink throws ENOENT -> still 204
 */

import { NextRequest } from 'next/server'

// ---- Module mocks ----

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/logger', () => ({ logError: jest.fn(), logAccess: jest.fn(), log: jest.fn() }))
jest.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    taskAttachment: {
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  },
}))
jest.mock('@/lib/ratelimit', () => ({
  checkTaskMgmtRateLimit: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('fs/promises', () => ({
  unlink: jest.fn().mockResolvedValue(undefined),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { checkTaskMgmtRateLimit } from '@/lib/ratelimit'
import { unlink } from 'fs/promises'
import { DELETE } from '@/app/api/users/[userId]/tasks/[taskId]/attachments/[attachmentId]/route'

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockUserFindUnique = prisma.user.findUnique as jest.MockedFunction<typeof prisma.user.findUnique>
const mockFindUnique = prisma.taskAttachment.findUnique as jest.MockedFunction<
  typeof prisma.taskAttachment.findUnique
>
const mockDelete = prisma.taskAttachment.delete as jest.MockedFunction<
  typeof prisma.taskAttachment.delete
>
const mockCheckRateLimit = checkTaskMgmtRateLimit as jest.MockedFunction<
  typeof checkTaskMgmtRateLimit
>
const mockUnlink = unlink as jest.MockedFunction<typeof unlink>

// ---- Helpers ----

const VALID_USER_ID = 'c111111111111111111111111'
const VALID_TASK_ID = 'c222222222222222222222222'
const VALID_ATTACHMENT_ID = 'c333333333333333333333333'
const OTHER_USER_ID = 'c444444444444444444444444'
const OTHER_TASK_ID = 'c555555555555555555555555'

function makeSession(role: string) {
  return { user: { id: 'c666666666666666666666666', name: 'HR', email: 'hr@test.com', role } }
}

function makeContext(
  userId = VALID_USER_ID,
  taskId = VALID_TASK_ID,
  attachmentId = VALID_ATTACHMENT_ID,
) {
  return { params: { userId, taskId, attachmentId } }
}

function makeRequest(): NextRequest {
  return new NextRequest(
    `http://localhost/api/users/${VALID_USER_ID}/tasks/${VALID_TASK_ID}/attachments/${VALID_ATTACHMENT_ID}`,
    { method: 'DELETE' },
  )
}

const MOCK_ATTACHMENT = {
  id: VALID_ATTACHMENT_ID,
  storagePath: 'a1b2c3d4-uuid.pdf',
  userTask: { userId: VALID_USER_ID, taskId: VALID_TASK_ID },
}

// ---- Setup ----

beforeEach(() => {
  jest.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(undefined)
  mockUserFindUnique.mockResolvedValue({ active: true } as never)
  mockFindUnique.mockResolvedValue(MOCK_ATTACHMENT as never)
  mockDelete.mockResolvedValue(MOCK_ATTACHMENT as never)
  mockUnlink.mockResolvedValue(undefined)
})

// ---- Tests ----

describe('DELETE /api/users/[userId]/tasks/[taskId]/attachments/[attachmentId] — authentication', () => {
  it('returns 401 when no session exists', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await DELETE(makeRequest(), makeContext())
    expect(res.status).toBe(401)
  })
})

describe('DELETE — authorization', () => {
  it('returns 403 for USER role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    const res = await DELETE(makeRequest(), makeContext())
    expect(res.status).toBe(403)
  })
})

describe('DELETE — rate limiting', () => {
  it('returns 429 when rate limit is exceeded', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockCheckRateLimit.mockRejectedValueOnce(new Error('Rate limit'))
    const res = await DELETE(makeRequest(), makeContext())
    expect(res.status).toBe(429)
  })
})

describe('DELETE — input validation', () => {
  it('returns 400 for invalid attachmentId', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await DELETE(makeRequest(), makeContext(VALID_USER_ID, VALID_TASK_ID, 'bad-id'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/attachmentId/)
  })
})

describe('DELETE — attachment lookup', () => {
  it('returns 404 when attachment does not exist', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockFindUnique.mockResolvedValueOnce(null)
    const res = await DELETE(makeRequest(), makeContext())
    expect(res.status).toBe(404)
  })
})

describe('DELETE — IDOR prevention', () => {
  it('returns 404 when userTask.userId does not match URL userId', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockFindUnique.mockResolvedValueOnce({
      ...MOCK_ATTACHMENT,
      userTask: { userId: OTHER_USER_ID, taskId: VALID_TASK_ID },
    } as never)
    const res = await DELETE(makeRequest(), makeContext())
    expect(res.status).toBe(404)
  })

  it('returns 404 when userTask.taskId does not match URL taskId', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockFindUnique.mockResolvedValueOnce({
      ...MOCK_ATTACHMENT,
      userTask: { userId: VALID_USER_ID, taskId: OTHER_TASK_ID },
    } as never)
    const res = await DELETE(makeRequest(), makeContext())
    expect(res.status).toBe(404)
  })
})

describe('DELETE — path traversal guard', () => {
  it('returns 500 when storagePath contains ..', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockFindUnique.mockResolvedValueOnce({
      ...MOCK_ATTACHMENT,
      storagePath: '../etc/passwd',
    } as never)
    const res = await DELETE(makeRequest(), makeContext())
    expect(res.status).toBe(500)
  })
})

describe('DELETE — success', () => {
  it('returns 204 and calls prisma.taskAttachment.delete', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await DELETE(makeRequest(), makeContext())
    expect(res.status).toBe(204)
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: VALID_ATTACHMENT_ID } })
  })

  it('returns 204 even when unlink throws ENOENT (file already gone)', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockUnlink.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const res = await DELETE(makeRequest(), makeContext())
    expect(res.status).toBe(204)
  })
})
