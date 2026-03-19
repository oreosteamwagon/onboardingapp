/**
 * Tests for User Profile Fields expansion
 *
 * Covers:
 *   - Validation unit tests: validateName, validateDepartment, validatePositionCode
 *   - PATCH /api/users/[userId] — authorization
 *   - PATCH /api/users/[userId] — profile field validation (400 for bad input)
 *   - PATCH /api/users/[userId] — optional field nulling
 *   - PATCH /api/users/[userId] — rate limiting (429)
 *   - PATCH /api/users/[userId] — success (200 with updated fields)
 */

import { NextRequest } from 'next/server'
import {
  validateName,
  validateDepartment,
  validatePositionCode,
} from '@/lib/validation'

// ---- Module mocks ----

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/logger', () => ({ logError: jest.fn(), logAccess: jest.fn(), log: jest.fn() }))
jest.mock('@/lib/db', () => ({
  prisma: {
    user: {
      update: jest.fn(),
    },
  },
}))
jest.mock('@/lib/ratelimit', () => ({
  checkUserProfileUpdateRateLimit: jest.fn().mockResolvedValue(undefined),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { checkUserProfileUpdateRateLimit } from '@/lib/ratelimit'
import { PATCH } from '@/app/api/users/[userId]/route'

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockUserUpdate = prisma.user.update as jest.MockedFunction<typeof prisma.user.update>
const mockCheckRateLimit = checkUserProfileUpdateRateLimit as jest.MockedFunction<
  typeof checkUserProfileUpdateRateLimit
>

// ---- Helpers ----

function makeSession(role: string, id = 'admin-1') {
  return { user: { id, name: 'Admin', email: 'admin@test.com', role } }
}

const VALID_USER_ID = 'c123456789012345678901234'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/users/${VALID_USER_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeContext(userId = VALID_USER_ID) {
  return { params: { userId } }
}

// ---- Validation unit tests ----

describe('validateName', () => {
  it('accepts basic Latin names', () => {
    expect(validateName('Mary-Jane', 'firstName')).toBeNull()
  })

  it('accepts names with apostrophes', () => {
    expect(validateName("O'Brien", 'lastName')).toBeNull()
  })

  it('accepts names with Latin Extended characters', () => {
    expect(validateName('José', 'firstName')).toBeNull()
  })

  it('accepts names with periods (e.g. Jr.)', () => {
    expect(validateName('Jr.', 'firstName')).toBeNull()
  })

  it('rejects empty string', () => {
    expect(validateName('', 'firstName')).toMatch(/firstName/)
  })

  it('rejects strings longer than 100 characters', () => {
    expect(validateName('a'.repeat(101), 'firstName')).not.toBeNull()
  })

  it('accepts exactly 100 characters', () => {
    expect(validateName('a'.repeat(100), 'firstName')).toBeNull()
  })

  it('rejects digits in names', () => {
    expect(validateName('12345', 'firstName')).not.toBeNull()
  })

  it('rejects null', () => {
    expect(validateName(null, 'firstName')).not.toBeNull()
  })

  it('rejects undefined', () => {
    expect(validateName(undefined, 'firstName')).not.toBeNull()
  })

  it('rejects SQL injection attempt', () => {
    expect(validateName("'; DROP TABLE users; --", 'firstName')).not.toBeNull()
  })

  it('rejects names with angle brackets', () => {
    expect(validateName('<script>', 'firstName')).not.toBeNull()
  })

  it('includes fieldName in error message', () => {
    const err = validateName('', 'lastName')
    expect(err).toMatch(/lastName/)
  })
})

describe('validateDepartment', () => {
  it('accepts "R&D"', () => {
    expect(validateDepartment('R&D')).toBeNull()
  })

  it('accepts "Human Resources"', () => {
    expect(validateDepartment('Human Resources')).toBeNull()
  })

  it('accepts alphanumeric with hyphens', () => {
    expect(validateDepartment('IT-Support')).toBeNull()
  })

  it('rejects empty string', () => {
    expect(validateDepartment('')).not.toBeNull()
  })

  it('rejects strings longer than 100 characters', () => {
    expect(validateDepartment('a'.repeat(101))).not.toBeNull()
  })

  it('rejects angle brackets (XSS attempt)', () => {
    expect(validateDepartment('<script>')).not.toBeNull()
  })

  it('rejects null', () => {
    expect(validateDepartment(null)).not.toBeNull()
  })

  it('rejects special chars like @', () => {
    expect(validateDepartment('IT@Corp')).not.toBeNull()
  })
})

describe('validatePositionCode', () => {
  it('accepts "ENG-001"', () => {
    expect(validatePositionCode('ENG-001')).toBeNull()
  })

  it('accepts "HR_MGR"', () => {
    expect(validatePositionCode('HR_MGR')).toBeNull()
  })

  it('accepts simple alphanumeric "P001"', () => {
    expect(validatePositionCode('P001')).toBeNull()
  })

  it('rejects empty string', () => {
    expect(validatePositionCode('')).not.toBeNull()
  })

  it('rejects strings longer than 50 characters', () => {
    expect(validatePositionCode('a'.repeat(51))).not.toBeNull()
  })

  it('rejects spaces', () => {
    expect(validatePositionCode('has space')).not.toBeNull()
  })

  it('rejects special chars like @', () => {
    expect(validatePositionCode('ENG@001')).not.toBeNull()
  })

  it('rejects null', () => {
    expect(validatePositionCode(null)).not.toBeNull()
  })
})

// ---- API tests ----

beforeEach(() => {
  jest.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(undefined)
})

describe('PATCH /api/users/[userId] — authentication', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await PATCH(makeRequest({ firstName: 'Jane' }), makeContext())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })
})

describe('PATCH /api/users/[userId] — authorization', () => {
  it('returns 403 for USER role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    const res = await PATCH(makeRequest({ firstName: 'Jane' }), makeContext())
    expect(res.status).toBe(403)
  })

  it('returns 403 for PAYROLL role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('PAYROLL') as never)
    const res = await PATCH(makeRequest({ firstName: 'Jane' }), makeContext())
    expect(res.status).toBe(403)
  })

  it('returns 403 for HR role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await PATCH(makeRequest({ firstName: 'Jane' }), makeContext())
    expect(res.status).toBe(403)
  })

  it('returns 403 for SUPERVISOR role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('SUPERVISOR') as never)
    const res = await PATCH(makeRequest({ firstName: 'Jane' }), makeContext())
    expect(res.status).toBe(403)
  })

  it('allows ADMIN to proceed past authorization', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockUserUpdate.mockResolvedValueOnce({ id: VALID_USER_ID } as never)
    const res = await PATCH(
      makeRequest({ firstName: 'Jane', lastName: 'Doe', department: 'HR', positionCode: 'HR001' }),
      makeContext(),
    )
    // Rate limit passes, update called — not a 403
    expect(res.status).not.toBe(403)
  })
})

describe('PATCH /api/users/[userId] — profile field validation', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession('ADMIN') as never)
  })

  it('returns 400 for invalid firstName (digits)', async () => {
    const res = await PATCH(makeRequest({ firstName: '12345' }), makeContext())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.errors).toBeDefined()
    expect(body.errors.some((e: string) => /firstName/.test(e))).toBe(true)
  })

  it('returns 400 for firstName that is too long (>100 chars)', async () => {
    const res = await PATCH(makeRequest({ firstName: 'a'.repeat(101) }), makeContext())
    expect(res.status).toBe(400)
  })

  it('returns 400 for empty firstName', async () => {
    const res = await PATCH(makeRequest({ firstName: '' }), makeContext())
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid positionCode (special chars)', async () => {
    const res = await PATCH(makeRequest({ positionCode: 'ENG@001' }), makeContext())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.errors.some((e: string) => /positionCode/.test(e))).toBe(true)
  })

  it('returns 400 for invalid department (angle brackets)', async () => {
    const res = await PATCH(makeRequest({ department: '<script>' }), makeContext())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.errors.some((e: string) => /department/.test(e))).toBe(true)
  })

  it('accepts null for preferredFirstName (clears the field)', async () => {
    mockUserUpdate.mockResolvedValueOnce({ id: VALID_USER_ID, preferredFirstName: null } as never)
    const res = await PATCH(makeRequest({ preferredFirstName: null }), makeContext())
    expect(res.status).toBe(200)
  })

  it('accepts null for preferredLastName (clears the field)', async () => {
    mockUserUpdate.mockResolvedValueOnce({ id: VALID_USER_ID, preferredLastName: null } as never)
    const res = await PATCH(makeRequest({ preferredLastName: null }), makeContext())
    expect(res.status).toBe(200)
  })

  it('accepts a valid preferredFirstName string', async () => {
    mockUserUpdate.mockResolvedValueOnce({ id: VALID_USER_ID, preferredFirstName: 'Jamie' } as never)
    const res = await PATCH(makeRequest({ preferredFirstName: 'Jamie' }), makeContext())
    expect(res.status).toBe(200)
  })

  it('returns 400 for no valid fields to update', async () => {
    const res = await PATCH(makeRequest({}), makeContext())
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/users/[userId] — rate limiting', () => {
  it('returns 429 when profile update rate limit is exceeded', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockCheckRateLimit.mockRejectedValueOnce(new Error('Rate limit exceeded'))
    const res = await PATCH(
      makeRequest({ firstName: 'Jane', lastName: 'Doe', department: 'HR', positionCode: 'HR001' }),
      makeContext(),
    )
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('Too many requests')
  })

  it('keys rate limit on the admin user id', async () => {
    const adminId = 'c000000000000000000000001'
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN', adminId) as never)
    mockUserUpdate.mockResolvedValueOnce({ id: VALID_USER_ID } as never)
    await PATCH(
      makeRequest({ firstName: 'Jane', lastName: 'Doe', department: 'HR', positionCode: 'HR001' }),
      makeContext(),
    )
    expect(mockCheckRateLimit).toHaveBeenCalledWith(adminId)
  })
})

describe('PATCH /api/users/[userId] — success', () => {
  const updatedUser = {
    id: VALID_USER_ID,
    username: 'jdoe',
    email: 'jdoe@example.com',
    role: 'USER',
    active: true,
    createdAt: new Date(),
    firstName: 'Jane',
    lastName: 'Doe',
    preferredFirstName: null,
    preferredLastName: null,
    department: 'Engineering',
    positionCode: 'ENG-001',
  }

  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession('ADMIN') as never)
    mockUserUpdate.mockResolvedValue(updatedUser as never)
  })

  it('returns 200 with updated user including profile fields', async () => {
    const res = await PATCH(
      makeRequest({
        firstName: 'Jane',
        lastName: 'Doe',
        department: 'Engineering',
        positionCode: 'ENG-001',
      }),
      makeContext(),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.firstName).toBe('Jane')
    expect(body.lastName).toBe('Doe')
    expect(body.department).toBe('Engineering')
    expect(body.positionCode).toBe('ENG-001')
  })

  it('calls prisma.user.update with correct profile data', async () => {
    await PATCH(
      makeRequest({ firstName: 'Jane', lastName: 'Doe' }),
      makeContext(),
    )
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: VALID_USER_ID },
        data: expect.objectContaining({ firstName: 'Jane', lastName: 'Doe' }),
      }),
    )
  })
})
