/**
 * Tests for POST /api/admin/factory-reset
 *
 * Covers:
 *   - Authentication: no session -> 401
 *   - Authorization: non-ADMIN roles -> 403; ADMIN -> allowed
 *   - Rate limit exceeded -> 429
 *   - Input validation: missing body, wrong confirm token -> 400
 *   - DB transaction failure -> 500 (no data changed)
 *   - Success: correct deletion order, files deleted, response shape
 *   - File deletion errors are tolerated (DB success still returns 200)
 */

import { NextRequest } from 'next/server'

// ---- Module mocks ----

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))

const mockDeleteMany = jest.fn().mockResolvedValue({ count: 0 })
const mockDocumentFindMany = jest.fn()
const mockTransaction = jest.fn()

jest.mock('@/lib/db', () => ({
  prisma: {
    $transaction: mockTransaction,
    document: { findMany: mockDocumentFindMany, deleteMany: mockDeleteMany },
    userTask: { deleteMany: mockDeleteMany },
    userWorkflow: { deleteMany: mockDeleteMany },
    workflowTask: { deleteMany: mockDeleteMany },
    onboardingTask: { deleteMany: mockDeleteMany },
    workflow: { deleteMany: mockDeleteMany },
    user: { deleteMany: mockDeleteMany },
  },
}))

jest.mock('@/lib/ratelimit', () => ({
  checkFactoryResetRateLimit: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('fs/promises', () => ({
  unlink: jest.fn().mockResolvedValue(undefined),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { checkFactoryResetRateLimit } from '@/lib/ratelimit'
import { unlink } from 'fs/promises'
import { POST } from '@/app/api/admin/factory-reset/route'

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockCheckRateLimit = checkFactoryResetRateLimit as jest.MockedFunction<
  typeof checkFactoryResetRateLimit
>
const mockUnlink = unlink as jest.MockedFunction<typeof unlink>

// ---- Helpers ----

function makeSession(role: string, id = 'admin-user-id') {
  return { user: { id, name: 'Admin', email: 'admin@test.com', role } }
}

function makeRequest(body?: unknown): NextRequest {
  const bodyStr = body !== undefined ? JSON.stringify(body) : undefined
  return new NextRequest('http://localhost/api/admin/factory-reset', {
    method: 'POST',
    headers: bodyStr ? { 'Content-Type': 'application/json' } : {},
    body: bodyStr,
  })
}

const VALID_BODY = { confirm: 'FACTORY_RESET' }

// ---- Setup ----

beforeEach(() => {
  jest.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(undefined)
  mockDocumentFindMany.mockResolvedValue([])

  // Default: transaction executes the callback with the mock prisma
  mockTransaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) =>
    fn(prisma),
  )
})

// ---- Tests ----

describe('POST /api/admin/factory-reset — authentication', () => {
  it('returns 401 when no session exists', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })
})

describe('POST /api/admin/factory-reset — authorization', () => {
  it('returns 403 for USER role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Forbidden')
  })

  it('returns 403 for PAYROLL role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('PAYROLL') as never)
    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(403)
  })

  it('returns 403 for HR role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(403)
  })

  it('returns 403 for SUPERVISOR role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('SUPERVISOR') as never)
    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(403)
  })

  it('allows ADMIN role to proceed', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/admin/factory-reset — rate limiting', () => {
  it('returns 429 when rate limit is exceeded', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockCheckRateLimit.mockRejectedValueOnce(new Error('Rate limit exceeded'))
    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('Too many requests')
  })

  it('keys rate limit on the admin user id', async () => {
    const adminId = 'specific-admin-id'
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN', adminId) as never)
    await POST(makeRequest(VALID_BODY))
    expect(mockCheckRateLimit).toHaveBeenCalledWith(adminId)
  })
})

describe('POST /api/admin/factory-reset — input validation', () => {
  it('returns 400 when body is missing', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    const req = new NextRequest('http://localhost/api/admin/factory-reset', {
      method: 'POST',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when confirm token is wrong', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    const res = await POST(makeRequest({ confirm: 'wrong' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/confirm/i)
  })

  it('returns 400 when confirm field is missing', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 400 when confirm is correct but capitalised differently', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    const res = await POST(makeRequest({ confirm: 'factory_reset' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when body is a plain string instead of JSON object', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    const res = await POST(makeRequest('FACTORY_RESET'))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/admin/factory-reset — DB failure', () => {
  it('returns 500 and does not proceed to file deletion when transaction throws', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockDocumentFindMany.mockResolvedValueOnce([{ storagePath: 'file.pdf' }])
    mockTransaction.mockRejectedValueOnce(new Error('DB error'))

    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/no data was changed/i)
    // File must NOT be deleted when DB transaction failed
    expect(mockUnlink).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/factory-reset — deletion order', () => {
  // Track the order in which deleteMany is called by capturing call order
  it('deletes UserTask before Document', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)

    const callOrder: string[] = []
    const trackingTx = {
      userTask: {
        deleteMany: jest.fn().mockImplementation(() => {
          callOrder.push('userTask')
          return Promise.resolve({ count: 0 })
        }),
      },
      userWorkflow: {
        deleteMany: jest.fn().mockImplementation(() => {
          callOrder.push('userWorkflow')
          return Promise.resolve({ count: 0 })
        }),
      },
      workflowTask: {
        deleteMany: jest.fn().mockImplementation(() => {
          callOrder.push('workflowTask')
          return Promise.resolve({ count: 0 })
        }),
      },
      document: {
        deleteMany: jest.fn().mockImplementation(() => {
          callOrder.push('document')
          return Promise.resolve({ count: 0 })
        }),
      },
      onboardingTask: {
        deleteMany: jest.fn().mockImplementation(() => {
          callOrder.push('onboardingTask')
          return Promise.resolve({ count: 0 })
        }),
      },
      workflow: {
        deleteMany: jest.fn().mockImplementation(() => {
          callOrder.push('workflow')
          return Promise.resolve({ count: 0 })
        }),
      },
      user: {
        deleteMany: jest.fn().mockImplementation(() => {
          callOrder.push('user')
          return Promise.resolve({ count: 0 })
        }),
      },
    }
    mockTransaction.mockImplementationOnce(
      (fn: (tx: typeof trackingTx) => Promise<unknown>) => fn(trackingTx),
    )

    await POST(makeRequest(VALID_BODY))

    expect(callOrder).toEqual([
      'userTask',
      'userWorkflow',
      'workflowTask',
      'document',
      'onboardingTask',
      'workflow',
      'user',
    ])
  })

  it('deletes only non-ADMIN users', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)

    let userDeleteArgs: unknown
    const trackingTx = {
      userTask: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      userWorkflow: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      workflowTask: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      document: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      onboardingTask: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      workflow: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      user: {
        deleteMany: jest.fn().mockImplementation((args: unknown) => {
          userDeleteArgs = args
          return Promise.resolve({ count: 0 })
        }),
      },
    }
    mockTransaction.mockImplementationOnce(
      (fn: (tx: typeof trackingTx) => Promise<unknown>) => fn(trackingTx),
    )

    await POST(makeRequest(VALID_BODY))

    expect(userDeleteArgs).toEqual({ where: { role: { not: 'ADMIN' } } })
  })
})

describe('POST /api/admin/factory-reset — file cleanup', () => {
  it('deletes each document file from disk after the transaction', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockDocumentFindMany.mockResolvedValueOnce([
      { storagePath: 'file-a.pdf' },
      { storagePath: 'file-b.png' },
    ])

    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(200)
    expect(mockUnlink).toHaveBeenCalledTimes(2)
    expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('file-a.pdf'))
    expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('file-b.png'))
  })

  it('returns 200 and reports fileErrors when a file cannot be deleted', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockDocumentFindMany.mockResolvedValueOnce([{ storagePath: 'missing.pdf' }])
    mockUnlink.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.filesDeleted).toBe(0)
    expect(body.fileErrors).toBe(1)
  })

  it('skips files with path separators in storagePath and counts them as errors', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockDocumentFindMany.mockResolvedValueOnce([{ storagePath: '../etc/passwd' }])

    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(mockUnlink).not.toHaveBeenCalled()
    expect(body.fileErrors).toBe(1)
  })

  it('returns 200 with zero filesDeleted when no documents exist', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockDocumentFindMany.mockResolvedValueOnce([])

    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.filesDeleted).toBe(0)
    expect(body.fileErrors).toBe(0)
  })
})

describe('POST /api/admin/factory-reset — success response shape', () => {
  it('returns message, filesDeleted, and fileErrors', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockDocumentFindMany.mockResolvedValueOnce([{ storagePath: 'doc.pdf' }])

    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Factory reset complete')
    expect(typeof body.filesDeleted).toBe('number')
    expect(typeof body.fileErrors).toBe('number')
  })
})
