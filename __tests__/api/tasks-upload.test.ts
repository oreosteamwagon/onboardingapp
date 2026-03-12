/**
 * Tests for POST /api/tasks/[taskId]/upload
 *
 * Covers:
 *   - Authentication (no session -> 401)
 *   - Rate-limit propagation (limiter throws -> 429)
 *   - Task existence (missing task -> 404)
 *   - Task type guard (STANDARD task -> 409)
 *   - Workflow membership check (no membership -> 403)
 *   - Missing file field (-> 400)
 *   - File validation error from saveUpload (UploadError -> 4xx pass-through)
 *   - Successful upload -> 200 with documentFilename
 */

import { NextRequest } from 'next/server'

// ---- Module mocks ----

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/db', () => ({
  prisma: {
    onboardingTask: {
      findUnique: jest.fn(),
    },
    workflowTask: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}))
jest.mock('@/lib/ratelimit', () => ({
  checkTaskMgmtRateLimit: jest.fn().mockResolvedValue(undefined),
  checkUploadRateLimit: jest.fn().mockResolvedValue(undefined),
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
import { saveUpload, UploadError } from '@/lib/upload'
import { checkUploadRateLimit } from '@/lib/ratelimit'
import { POST } from '@/app/api/tasks/[taskId]/upload/route'

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockFindUnique = prisma.onboardingTask.findUnique as jest.MockedFunction<
  typeof prisma.onboardingTask.findUnique
>
const mockWorkflowTaskFindFirst = prisma.workflowTask.findFirst as jest.MockedFunction<
  typeof prisma.workflowTask.findFirst
>
const mockTransaction = prisma.$transaction as jest.MockedFunction<
  typeof prisma.$transaction
>
const mockSaveUpload = saveUpload as jest.MockedFunction<typeof saveUpload>
const mockCheckUploadRateLimit = checkUploadRateLimit as jest.MockedFunction<
  typeof checkUploadRateLimit
>

// ---- Helpers ----

function makeSession(role: string, id = 'user-1') {
  return { user: { id, name: 'Test', email: 'test@test.com', role } }
}

const routeCtx = { params: { taskId: 'task-1' } }

async function makeUploadRequest(file?: File): Promise<NextRequest> {
  const formData = new FormData()
  if (file) {
    formData.append('file', file)
  }
  return new NextRequest('http://localhost/api/tasks/task-1/upload', {
    method: 'POST',
    body: formData,
  })
}

function makeFile(name = 'doc.pdf', type = 'application/pdf', size = 1024): File {
  const content = new Uint8Array(size).fill(0)
  return new File([content], name, { type })
}

// ============================================================

describe('POST /api/tasks/[taskId]/upload', () => {
  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null as never)
    const req = await makeUploadRequest()
    const res = await POST(req, routeCtx)
    expect(res.status).toBe(401)
  })

  it('returns 429 when upload rate limit exceeded', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    mockCheckUploadRateLimit.mockRejectedValueOnce(new Error('rate limit'))
    const req = await makeUploadRequest()
    const res = await POST(req, routeCtx)
    expect(res.status).toBe(429)
  })

  it('returns 404 when task does not exist', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    mockFindUnique.mockResolvedValueOnce(null as never)
    const req = await makeUploadRequest(makeFile())
    const res = await POST(req, routeCtx)
    expect(res.status).toBe(404)
  })

  it('returns 409 when task is STANDARD type', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    mockFindUnique.mockResolvedValueOnce({ taskType: 'STANDARD' } as never)
    const req = await makeUploadRequest(makeFile())
    const res = await POST(req, routeCtx)
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toMatch(/does not require/)
  })

  it('returns 403 when task is not in any workflow assigned to user', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER', 'user-1') as never)
    mockFindUnique.mockResolvedValueOnce({ taskType: 'UPLOAD' } as never)
    mockWorkflowTaskFindFirst.mockResolvedValueOnce(null as never)
    const req = await makeUploadRequest(makeFile())
    const res = await POST(req, routeCtx)
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toMatch(/not assigned/)
  })

  it('returns 400 when file field is missing', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    mockFindUnique.mockResolvedValueOnce({ taskType: 'UPLOAD' } as never)
    mockWorkflowTaskFindFirst.mockResolvedValueOnce({ id: 'wt-1' } as never)
    const req = await makeUploadRequest() // no file
    const res = await POST(req, routeCtx)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/file/)
  })

  it('propagates UploadError status code from saveUpload (e.g. 415 for bad MIME)', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    mockFindUnique.mockResolvedValueOnce({ taskType: 'UPLOAD' } as never)
    mockWorkflowTaskFindFirst.mockResolvedValueOnce({ id: 'wt-1' } as never)
    mockSaveUpload.mockRejectedValueOnce(new UploadError('File type not allowed', 415))
    const req = await makeUploadRequest(makeFile('bad.exe', 'application/x-msdownload'))
    const res = await POST(req, routeCtx)
    expect(res.status).toBe(415)
    const data = await res.json()
    expect(data.error).toMatch(/File type not allowed/)
  })

  it('propagates UploadError 413 for oversized file', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    mockFindUnique.mockResolvedValueOnce({ taskType: 'UPLOAD' } as never)
    mockWorkflowTaskFindFirst.mockResolvedValueOnce({ id: 'wt-1' } as never)
    mockSaveUpload.mockRejectedValueOnce(
      new UploadError('File exceeds maximum size of 25 MB', 413),
    )
    const req = await makeUploadRequest(makeFile('big.pdf', 'application/pdf'))
    const res = await POST(req, routeCtx)
    expect(res.status).toBe(413)
  })

  it('returns 200 with documentFilename on successful upload', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER', 'user-1') as never)
    mockFindUnique.mockResolvedValueOnce({ taskType: 'UPLOAD' } as never)
    mockWorkflowTaskFindFirst.mockResolvedValueOnce({ id: 'wt-1' } as never)
    mockSaveUpload.mockResolvedValueOnce({
      storagePath: 'uuid-file.pdf',
      filename: 'doc.pdf',
    })
    mockTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
      const fakeTx = {
        document: {
          create: jest.fn().mockResolvedValue({
            id: 'doc-1',
            filename: 'doc.pdf',
          }),
        },
        userTask: {
          upsert: jest.fn().mockResolvedValue({
            id: 'ut-1',
            completed: true,
            completedAt: new Date('2026-01-01'),
            documentId: 'doc-1',
            approvalStatus: 'PENDING',
          }),
        },
      }
      return fn(fakeTx)
    })

    const req = await makeUploadRequest(makeFile('doc.pdf'))
    const res = await POST(req, routeCtx)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.completed).toBe(true)
    expect(data.documentFilename).toBe('doc.pdf')
  })

  it('returns 500 when transaction fails', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    mockFindUnique.mockResolvedValueOnce({ taskType: 'UPLOAD' } as never)
    mockWorkflowTaskFindFirst.mockResolvedValueOnce({ id: 'wt-1' } as never)
    mockSaveUpload.mockResolvedValueOnce({ storagePath: 'f.pdf', filename: 'f.pdf' })
    mockTransaction.mockRejectedValueOnce(new Error('DB error'))
    const req = await makeUploadRequest(makeFile())
    const res = await POST(req, routeCtx)
    expect(res.status).toBe(500)
  })
})
