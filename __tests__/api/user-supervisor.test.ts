/**
 * Tests for supervisor field on User — POST /api/users and PATCH /api/users/[userId]
 *
 * Covers:
 *   - POST: supervisorId missing, invalid CUID, not found, inactive, wrong role, success
 *   - PATCH: supervisorId null (cannot clear), invalid CUID, self-assignment, wrong role, success
 *   - Both routes: 401 without session, 403 for non-ADMIN
 */

import { NextRequest } from 'next/server'

// ---- Module mocks ----

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/logger', () => ({ logError: jest.fn(), logAccess: jest.fn(), log: jest.fn() }))
jest.mock('@/lib/db', () => ({
  prisma: {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}))
jest.mock('@/lib/ratelimit', () => ({
  checkUserCreateRateLimit: jest.fn().mockResolvedValue(undefined),
  checkUserProfileUpdateRateLimit: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('$argon2id$hashed'),
  argon2id: 'argon2id',
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { checkUserCreateRateLimit, checkUserProfileUpdateRateLimit } from '@/lib/ratelimit'
import { POST } from '@/app/api/users/route'
import { PATCH } from '@/app/api/users/[userId]/route'

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockUserCreate = prisma.user.create as jest.MockedFunction<typeof prisma.user.create>
const mockUserFindUnique = prisma.user.findUnique as jest.MockedFunction<typeof prisma.user.findUnique>
const mockUserUpdate = prisma.user.update as jest.MockedFunction<typeof prisma.user.update>
const mockCheckCreateLimit = checkUserCreateRateLimit as jest.MockedFunction<typeof checkUserCreateRateLimit>
const mockCheckUpdateLimit = checkUserProfileUpdateRateLimit as jest.MockedFunction<typeof checkUserProfileUpdateRateLimit>

// ---- Helpers ----

function makeSession(role: string, id = 'c000000000000000000000001') {
  return { user: { id, name: 'Admin', email: 'admin@test.com', role } }
}

const VALID_USER_ID = 'c123456789012345678901234'
const VALID_SUPERVISOR_ID = 'c999999999999999999999999'

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makePatchRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/users/${VALID_USER_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeContext(userId = VALID_USER_ID) {
  return { params: { userId } }
}

const VALID_POST_BODY = {
  username: 'jdoe',
  email: 'jdoe@example.com',
  role: 'USER',
  firstName: 'Jane',
  lastName: 'Doe',
  department: 'Engineering',
  positionCode: 'ENG-001',
  supervisorId: VALID_SUPERVISOR_ID,
}

const SUPERVISOR_DB_RECORD = { role: 'SUPERVISOR', active: true }

// ---- Setup ----

beforeEach(() => {
  jest.clearAllMocks()
  mockCheckCreateLimit.mockResolvedValue(undefined)
  mockCheckUpdateLimit.mockResolvedValue(undefined)
})

// ---- POST /api/users — authorization ----

describe('POST /api/users — authorization', () => {
  it('returns 401 with no session', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await POST(makePostRequest(VALID_POST_BODY))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })

  it('returns 403 for USER role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    const res = await POST(makePostRequest(VALID_POST_BODY))
    expect(res.status).toBe(403)
  })

  it('returns 403 for SUPERVISOR role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('SUPERVISOR') as never)
    const res = await POST(makePostRequest(VALID_POST_BODY))
    expect(res.status).toBe(403)
  })

  it('returns 403 for HR role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await POST(makePostRequest(VALID_POST_BODY))
    expect(res.status).toBe(403)
  })
})

// ---- POST /api/users — supervisorId validation ----

describe('POST /api/users — supervisorId validation', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession('ADMIN') as never)
  })

  it('returns 400 when supervisorId is missing', async () => {
    const body = { ...VALID_POST_BODY }
    delete (body as Record<string, unknown>).supervisorId
    const res = await POST(makePostRequest(body))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/missing/i)
  })

  it('returns 400 when supervisorId is not a valid CUID', async () => {
    const res = await POST(makePostRequest({ ...VALID_POST_BODY, supervisorId: 'not-a-cuid' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.errors.some((e: string) => /supervisorId/.test(e))).toBe(true)
  })

  it('returns 400 when referenced user does not exist', async () => {
    mockUserFindUnique.mockResolvedValueOnce(null)
    const res = await POST(makePostRequest(VALID_POST_BODY))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/supervisorId/)
  })

  it('returns 400 when referenced user is inactive', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ role: 'SUPERVISOR', active: false } as never)
    const res = await POST(makePostRequest(VALID_POST_BODY))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/supervisorId/)
  })

  it('returns 400 when referenced user has role USER (insufficient)', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ role: 'USER', active: true } as never)
    const res = await POST(makePostRequest(VALID_POST_BODY))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/supervisorId/)
  })

  it('returns 201 with a valid active SUPERVISOR+ supervisorId', async () => {
    mockUserFindUnique.mockResolvedValueOnce(SUPERVISOR_DB_RECORD as never)
    const createdUser = {
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
      supervisorId: VALID_SUPERVISOR_ID,
      supervisor: { id: VALID_SUPERVISOR_ID, firstName: 'Bob', lastName: 'Smith', username: 'bsmith' },
    }
    mockUserCreate.mockResolvedValueOnce(createdUser as never)
    const res = await POST(makePostRequest(VALID_POST_BODY))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.user.supervisorId).toBe(VALID_SUPERVISOR_ID)
  })

  it('accepts PAYROLL role as supervisor', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ role: 'PAYROLL', active: true } as never)
    mockUserCreate.mockResolvedValueOnce({ id: VALID_USER_ID, supervisorId: VALID_SUPERVISOR_ID } as never)
    const res = await POST(makePostRequest(VALID_POST_BODY))
    expect(res.status).toBe(201)
  })

  it('accepts ADMIN role as supervisor', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ role: 'ADMIN', active: true } as never)
    mockUserCreate.mockResolvedValueOnce({ id: VALID_USER_ID, supervisorId: VALID_SUPERVISOR_ID } as never)
    const res = await POST(makePostRequest(VALID_POST_BODY))
    expect(res.status).toBe(201)
  })
})

// ---- PATCH /api/users/[userId] — authorization ----

describe('PATCH /api/users/[userId] — authorization', () => {
  it('returns 401 with no session', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await PATCH(makePatchRequest({ supervisorId: VALID_SUPERVISOR_ID }), makeContext())
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-ADMIN roles', async () => {
    for (const role of ['USER', 'SUPERVISOR', 'PAYROLL', 'HR']) {
      mockAuth.mockResolvedValueOnce(makeSession(role) as never)
      const res = await PATCH(makePatchRequest({ supervisorId: VALID_SUPERVISOR_ID }), makeContext())
      expect(res.status).toBe(403)
    }
  })
})

// ---- PATCH /api/users/[userId] — supervisorId validation ----

describe('PATCH /api/users/[userId] — supervisorId validation', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession('ADMIN') as never)
  })

  it('returns 400 when supervisorId is null (cannot clear required field)', async () => {
    const res = await PATCH(makePatchRequest({ supervisorId: null }), makeContext())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.errors.some((e: string) => /supervisorId/.test(e))).toBe(true)
  })

  it('returns 400 when supervisorId is an invalid CUID', async () => {
    const res = await PATCH(makePatchRequest({ supervisorId: 'bad-id' }), makeContext())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.errors.some((e: string) => /supervisorId/.test(e))).toBe(true)
  })

  it('returns 400 when supervisorId equals userId (self-assignment)', async () => {
    const res = await PATCH(makePatchRequest({ supervisorId: VALID_USER_ID }), makeContext(VALID_USER_ID))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/supervisorId/)
  })

  it('returns 400 when referenced user is not SUPERVISOR+', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ role: 'USER', active: true } as never)
    const res = await PATCH(makePatchRequest({ supervisorId: VALID_SUPERVISOR_ID }), makeContext())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/supervisorId/)
  })

  it('returns 400 when referenced user is inactive', async () => {
    mockUserFindUnique.mockResolvedValueOnce({ role: 'SUPERVISOR', active: false } as never)
    const res = await PATCH(makePatchRequest({ supervisorId: VALID_SUPERVISOR_ID }), makeContext())
    expect(res.status).toBe(400)
  })

  it('returns 200 when changing to a valid SUPERVISOR+ user', async () => {
    mockUserFindUnique.mockResolvedValueOnce(SUPERVISOR_DB_RECORD as never)
    const updatedUser = {
      id: VALID_USER_ID,
      supervisorId: VALID_SUPERVISOR_ID,
      supervisor: { id: VALID_SUPERVISOR_ID, firstName: 'Bob', lastName: 'Smith', username: 'bsmith' },
    }
    mockUserUpdate.mockResolvedValueOnce(updatedUser as never)
    const res = await PATCH(makePatchRequest({ supervisorId: VALID_SUPERVISOR_ID }), makeContext())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.supervisorId).toBe(VALID_SUPERVISOR_ID)
  })

  it('passes supervisorId to prisma.user.update', async () => {
    mockUserFindUnique.mockResolvedValueOnce(SUPERVISOR_DB_RECORD as never)
    mockUserUpdate.mockResolvedValueOnce({ id: VALID_USER_ID, supervisorId: VALID_SUPERVISOR_ID } as never)
    await PATCH(makePatchRequest({ supervisorId: VALID_SUPERVISOR_ID }), makeContext())
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: VALID_USER_ID },
        data: expect.objectContaining({ supervisorId: VALID_SUPERVISOR_ID }),
      }),
    )
  })
})
