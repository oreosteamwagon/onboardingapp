/**
 * Tests for POST /api/users/[userId]/reset-password
 *
 * Covers:
 *   - Authentication: no session -> 401
 *   - Authorization: non-ADMIN roles -> 403; ADMIN -> allowed
 *   - Input validation: invalid userId format -> 400
 *   - User not found -> 404
 *   - Inactive user -> 409
 *   - Rate limit exceeded -> 429
 *   - Success: hashes new password, returns tempPassword, never returns passwordHash
 */

import { NextRequest } from 'next/server'

// ---- Module mocks ----
// Explicit factories prevent Jest from loading real modules that pull in ESM deps.

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}))
jest.mock('@/lib/ratelimit', () => ({
  checkPasswordResetRateLimit: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('$argon2id$v=19$mock-hash'),
  argon2id: 2,
}))
// crypto.randomBytes is a Node built-in that works correctly in tests — no mock needed

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { checkPasswordResetRateLimit } from '@/lib/ratelimit'
import argon2 from 'argon2'
import { POST } from '@/app/api/users/[userId]/reset-password/route'

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockUserFindUnique = prisma.user.findUnique as jest.MockedFunction<
  typeof prisma.user.findUnique
>
const mockUserUpdate = prisma.user.update as jest.MockedFunction<
  typeof prisma.user.update
>
const mockCheckRateLimit = checkPasswordResetRateLimit as jest.MockedFunction<
  typeof checkPasswordResetRateLimit
>
const mockArgon2Hash = argon2.hash as jest.MockedFunction<typeof argon2.hash>

// ---- Helpers ----

function makeSession(role: string, id = 'admin-1') {
  return { user: { id, name: 'Admin', email: 'admin@test.com', role } }
}

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/users/c123456789012345678901234/reset-password', {
    method: 'POST',
  })
}

// Valid CUID: starts with 'c' followed by exactly 24 lowercase alphanumeric chars (25 total)
const VALID_USER_ID = 'c123456789012345678901234'
const INVALID_USER_ID = 'not-a-valid-cuid'

function makeContext(userId = VALID_USER_ID) {
  return { params: { userId } }
}

// ---- Tests ----

beforeEach(() => {
  jest.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(undefined)
  mockArgon2Hash.mockResolvedValue('$argon2id$v=19$mock-hash' as never)
  mockUserFindUnique.mockResolvedValue({ active: true } as never)
})

describe('POST /api/users/[userId]/reset-password — authentication', () => {
  it('returns 401 when no session exists', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })
})

describe('POST /api/users/[userId]/reset-password — authorization', () => {
  it('returns 403 for USER role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Forbidden')
  })

  it('returns 403 for PAYROLL role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('PAYROLL') as never)
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(403)
  })

  it('returns 403 for HR role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(403)
  })

  it('returns 403 for SUPERVISOR role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('SUPERVISOR') as never)
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(403)
  })

  it('allows ADMIN role to proceed past authorization', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    // verifyActiveSession consumes first findUnique; target user not found -> 404
    mockUserFindUnique.mockResolvedValueOnce({ active: true } as never) // verifyActiveSession
    mockUserFindUnique.mockResolvedValueOnce(null) // target user lookup
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(404)
  })
})

describe('POST /api/users/[userId]/reset-password — rate limiting', () => {
  it('returns 429 when rate limit is exceeded', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockCheckRateLimit.mockRejectedValueOnce(new Error('Rate limit exceeded'))
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('Too many requests')
  })

  it('keys rate limit on the admin user id, not the target user id', async () => {
    const adminId = 'admin-specific-id'
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN', adminId) as never)
    mockUserFindUnique.mockResolvedValueOnce({ active: true } as never) // verifyActiveSession
    mockUserFindUnique.mockResolvedValueOnce(null) // target user lookup
    await POST(makeRequest(), makeContext())
    expect(mockCheckRateLimit).toHaveBeenCalledWith(adminId)
  })
})

describe('POST /api/users/[userId]/reset-password — input validation', () => {
  it('returns 400 for an invalid userId (not a CUID)', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    const res = await POST(makeRequest(), makeContext(INVALID_USER_ID))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/userId/)
  })

  it('returns 400 for an empty string userId', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    const res = await POST(makeRequest(), makeContext(''))
    expect(res.status).toBe(400)
  })

  it('returns 400 for a userId that is too short', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    const res = await POST(makeRequest(), makeContext('c123'))
    expect(res.status).toBe(400)
  })

  it('returns 400 for a userId containing uppercase letters', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    // CUID regex requires lowercase alphanumeric only after 'c'
    const res = await POST(makeRequest(), makeContext('cABCDEFGHIJKLMNOPQRSTUVWX'))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/users/[userId]/reset-password — object-level checks', () => {
  it('returns 404 when user does not exist', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockUserFindUnique.mockResolvedValueOnce({ active: true } as never) // verifyActiveSession
    mockUserFindUnique.mockResolvedValueOnce(null) // target user lookup
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('User not found')
  })

  it('returns 409 when user is inactive', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockUserFindUnique.mockResolvedValueOnce({ active: true } as never) // verifyActiveSession
    mockUserFindUnique.mockResolvedValueOnce({ id: VALID_USER_ID, active: false } as never) // target user
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/inactive/)
  })
})

describe('POST /api/users/[userId]/reset-password — success', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockUserFindUnique.mockResolvedValueOnce({ id: VALID_USER_ID, active: true } as never)
    mockUserUpdate.mockResolvedValueOnce({ id: VALID_USER_ID } as never)
  })

  it('returns 200 with a tempPassword field', async () => {
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.tempPassword).toBe('string')
    expect(body.tempPassword.length).toBeGreaterThan(0)
  })

  it('does not return the passwordHash in the response', async () => {
    const res = await POST(makeRequest(), makeContext())
    const body = await res.json()
    expect(body.passwordHash).toBeUndefined()
  })

  it('hashes the temp password with Argon2id before storing', async () => {
    await POST(makeRequest(), makeContext())
    expect(mockArgon2Hash).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ type: argon2.argon2id }),
    )
  })

  it('stores the hash in the database via prisma.user.update', async () => {
    await POST(makeRequest(), makeContext())
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: VALID_USER_ID },
        data: expect.objectContaining({ passwordHash: expect.any(String) }),
      }),
    )
  })

  it('uses the correct Argon2id parameters (memory, time, parallelism)', async () => {
    await POST(makeRequest(), makeContext())
    expect(mockArgon2Hash).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
      }),
    )
  })

  it('queries the target userId, not the admin userId', async () => {
    await POST(makeRequest(), makeContext(VALID_USER_ID))
    expect(mockUserFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: VALID_USER_ID } }),
    )
  })
})
