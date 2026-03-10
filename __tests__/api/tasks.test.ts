/**
 * Tests for /api/tasks (GET, POST, PATCH) and /api/tasks/[taskId] (GET, PUT, DELETE).
 *
 * Covers:
 *   - Authentication (no session -> 401)
 *   - Authorization (wrong role -> 403)
 *   - Input validation (missing fields, bad types, oversized strings, invalid enums)
 *   - Object-level checks (user can only update their own UserTask)
 *   - UPLOAD task rejection via PATCH
 *   - DELETE blocked when UserTask records exist
 */

import { NextRequest } from 'next/server'

// ---- Module mocks ----

jest.mock('@/lib/auth')
jest.mock('@/lib/db', () => ({
  prisma: {
    onboardingTask: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    userTask: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}))
jest.mock('@/lib/ratelimit', () => ({
  checkTaskMgmtRateLimit: jest.fn().mockResolvedValue(undefined),
  checkUploadRateLimit: jest.fn().mockResolvedValue(undefined),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { GET, POST, PATCH } from '@/app/api/tasks/route'
import {
  GET as getTask,
  PUT as putTask,
  DELETE as deleteTask,
} from '@/app/api/tasks/[taskId]/route'

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockFindMany = prisma.onboardingTask.findMany as jest.MockedFunction<
  typeof prisma.onboardingTask.findMany
>
const mockFindUnique = prisma.onboardingTask.findUnique as jest.MockedFunction<
  typeof prisma.onboardingTask.findUnique
>
const mockCreate = prisma.onboardingTask.create as jest.MockedFunction<
  typeof prisma.onboardingTask.create
>
const mockUpdate = prisma.onboardingTask.update as jest.MockedFunction<
  typeof prisma.onboardingTask.update
>
const mockDelete = prisma.onboardingTask.delete as jest.MockedFunction<
  typeof prisma.onboardingTask.delete
>
const mockUpsert = prisma.userTask.upsert as jest.MockedFunction<
  typeof prisma.userTask.upsert
>

// ---- Helpers ----

function makeSession(role: string, id = 'user-1') {
  return { user: { id, name: 'Test', email: 'test@test.com', role } }
}

function makeRequest(body?: unknown, method = 'POST'): NextRequest {
  return new NextRequest('http://localhost/api/tasks', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function makeTaskRouteRequest(body?: unknown, method = 'PUT'): NextRequest {
  return new NextRequest('http://localhost/api/tasks/task-1', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const taskRouteCtx = { params: { taskId: 'task-1' } }

const sampleTask = {
  id: 'task-1',
  title: 'Sign NDA',
  description: null,
  taskType: 'STANDARD' as const,
  assignedRole: ['USER'],
  order: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
}

// ============================================================
// GET /api/tasks
// ============================================================

describe('GET /api/tasks', () => {
  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null as never)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns 403 when role is USER', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('returns 403 when role is PAYROLL', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('PAYROLL') as never)
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('returns 200 and task list for HR role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockFindMany.mockResolvedValueOnce([sampleTask] as never)
    const res = await GET()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data)).toBe(true)
  })

  it('returns 200 for ADMIN role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockFindMany.mockResolvedValueOnce([]) as never
    const res = await GET()
    expect(res.status).toBe(200)
  })
})

// ============================================================
// POST /api/tasks — create task
// ============================================================

describe('POST /api/tasks', () => {
  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null as never)
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 403 when role is USER', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    const res = await POST(makeRequest())
    expect(res.status).toBe(403)
  })

  it('returns 400 when title is missing', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await POST(
      makeRequest({ description: 'desc', assignedRole: ['USER'], taskType: 'STANDARD' }),
    )
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/title/)
  })

  it('returns 400 when title exceeds 256 characters', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await POST(
      makeRequest({
        title: 'a'.repeat(257),
        assignedRole: ['USER'],
        taskType: 'STANDARD',
      }),
    )
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/title/)
  })

  it('returns 400 when description exceeds 2000 characters', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await POST(
      makeRequest({
        title: 'Valid',
        description: 'x'.repeat(2001),
        assignedRole: ['USER'],
        taskType: 'STANDARD',
      }),
    )
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/description/)
  })

  it('returns 400 when taskType is invalid', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await POST(
      makeRequest({
        title: 'Valid',
        assignedRole: ['USER'],
        taskType: 'INVALID_TYPE',
      }),
    )
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/taskType/)
  })

  it('returns 400 when assignedRole is empty', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await POST(
      makeRequest({ title: 'Valid', assignedRole: [], taskType: 'STANDARD' }),
    )
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/assignedRole/)
  })

  it('returns 400 when assignedRole contains an invalid value', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await POST(
      makeRequest({
        title: 'Valid',
        assignedRole: ['NOTAROLE'],
        taskType: 'STANDARD',
      }),
    )
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/Invalid role/)
  })

  it('returns 400 when assignedRole is not an array', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await POST(
      makeRequest({ title: 'Valid', assignedRole: 'USER', taskType: 'STANDARD' }),
    )
    expect(res.status).toBe(400)
  })

  it('creates a STANDARD task and returns 201', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockCreate.mockResolvedValueOnce(sampleTask as never)
    const res = await POST(
      makeRequest({
        title: 'Sign NDA',
        assignedRole: ['USER'],
        taskType: 'STANDARD',
      }),
    )
    expect(res.status).toBe(201)
  })

  it('creates an UPLOAD task and returns 201', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const uploadTask = { ...sampleTask, taskType: 'UPLOAD' as const }
    mockCreate.mockResolvedValueOnce(uploadTask as never)
    const res = await POST(
      makeRequest({
        title: 'Upload ID',
        assignedRole: ['USER'],
        taskType: 'UPLOAD',
      }),
    )
    expect(res.status).toBe(201)
  })

  it('returns 400 for malformed JSON body', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const req = new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

// ============================================================
// PATCH /api/tasks — complete/incomplete a STANDARD task
// ============================================================

describe('PATCH /api/tasks', () => {
  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null as never)
    const res = await PATCH(makeRequest({ userId: 'u1', taskId: 't1', completed: true }, 'PATCH'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when userId does not match session userId', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER', 'user-1') as never)
    const res = await PATCH(
      makeRequest({ userId: 'other-user', taskId: 'task-1', completed: true }, 'PATCH'),
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 when required fields are missing', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER', 'user-1') as never)
    const res = await PATCH(makeRequest({ userId: 'user-1' }, 'PATCH'))
    expect(res.status).toBe(400)
  })

  it('returns 404 when task does not exist', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER', 'user-1') as never)
    mockFindUnique.mockResolvedValueOnce(null as never)
    const res = await PATCH(
      makeRequest({ userId: 'user-1', taskId: 'task-1', completed: true }, 'PATCH'),
    )
    expect(res.status).toBe(404)
  })

  it('returns 409 when task is UPLOAD type — checkbox toggle is forbidden', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER', 'user-1') as never)
    mockFindUnique.mockResolvedValueOnce({
      assignedRole: ['USER'],
      taskType: 'UPLOAD',
    } as never)
    const res = await PATCH(
      makeRequest({ userId: 'user-1', taskId: 'task-1', completed: true }, 'PATCH'),
    )
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toMatch(/upload/i)
  })

  it('returns 409 for UPLOAD task even when trying to mark incomplete via PATCH', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER', 'user-1') as never)
    mockFindUnique.mockResolvedValueOnce({
      assignedRole: ['USER'],
      taskType: 'UPLOAD',
    } as never)
    const res = await PATCH(
      makeRequest({ userId: 'user-1', taskId: 'task-1', completed: false }, 'PATCH'),
    )
    expect(res.status).toBe(409)
  })

  it('returns 403 when task is not assigned to user role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER', 'user-1') as never)
    mockFindUnique.mockResolvedValueOnce({
      assignedRole: ['HR'],
      taskType: 'STANDARD',
    } as never)
    const res = await PATCH(
      makeRequest({ userId: 'user-1', taskId: 'task-1', completed: true }, 'PATCH'),
    )
    expect(res.status).toBe(403)
  })

  it('upserts UserTask and returns 200 for a valid STANDARD toggle', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER', 'user-1') as never)
    mockFindUnique.mockResolvedValueOnce({
      assignedRole: ['USER'],
      taskType: 'STANDARD',
    } as never)
    mockUpsert.mockResolvedValueOnce({
      id: 'ut-1',
      userId: 'user-1',
      taskId: 'task-1',
      completed: true,
      completedAt: new Date(),
      documentId: null,
    } as never)
    const res = await PATCH(
      makeRequest({ userId: 'user-1', taskId: 'task-1', completed: true }, 'PATCH'),
    )
    expect(res.status).toBe(200)
    expect(mockUpsert).toHaveBeenCalledTimes(1)
  })
})

// ============================================================
// GET /api/tasks/[taskId]
// ============================================================

describe('GET /api/tasks/[taskId]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValueOnce(null as never)
    const res = await getTask(makeTaskRouteRequest(undefined, 'GET'), taskRouteCtx)
    expect(res.status).toBe(401)
  })

  it('returns 403 for USER role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    const res = await getTask(makeTaskRouteRequest(undefined, 'GET'), taskRouteCtx)
    expect(res.status).toBe(403)
  })

  it('returns 404 when task does not exist', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockFindUnique.mockResolvedValueOnce(null as never)
    const res = await getTask(makeTaskRouteRequest(undefined, 'GET'), taskRouteCtx)
    expect(res.status).toBe(404)
  })

  it('returns 200 with task data for HR+', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockFindUnique.mockResolvedValueOnce(sampleTask as never)
    const res = await getTask(makeTaskRouteRequest(undefined, 'GET'), taskRouteCtx)
    expect(res.status).toBe(200)
  })
})

// ============================================================
// PUT /api/tasks/[taskId]
// ============================================================

describe('PUT /api/tasks/[taskId]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValueOnce(null as never)
    const res = await putTask(makeTaskRouteRequest({ title: 'New' }), taskRouteCtx)
    expect(res.status).toBe(401)
  })

  it('returns 403 for USER role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    const res = await putTask(makeTaskRouteRequest({ title: 'New' }), taskRouteCtx)
    expect(res.status).toBe(403)
  })

  it('returns 404 when task does not exist', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockFindUnique.mockResolvedValueOnce(null as never)
    const res = await putTask(makeTaskRouteRequest({ title: 'New' }), taskRouteCtx)
    expect(res.status).toBe(404)
  })

  it('returns 400 when no fields provided', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockFindUnique.mockResolvedValueOnce(sampleTask as never)
    const res = await putTask(makeTaskRouteRequest({}), taskRouteCtx)
    expect(res.status).toBe(400)
  })

  it('returns 400 when title is too long', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockFindUnique.mockResolvedValueOnce(sampleTask as never)
    const res = await putTask(
      makeTaskRouteRequest({ title: 'x'.repeat(257) }),
      taskRouteCtx,
    )
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/title/)
  })

  it('returns 400 when taskType is invalid', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockFindUnique.mockResolvedValueOnce(sampleTask as never)
    const res = await putTask(
      makeTaskRouteRequest({ taskType: 'BOGUS' }),
      taskRouteCtx,
    )
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/taskType/)
  })

  it('returns 400 when assignedRole contains invalid value', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockFindUnique.mockResolvedValueOnce(sampleTask as never)
    const res = await putTask(
      makeTaskRouteRequest({ assignedRole: ['GHOST'] }),
      taskRouteCtx,
    )
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/Invalid role/)
  })

  it('updates and returns 200 for valid payload', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockFindUnique.mockResolvedValueOnce(sampleTask as never)
    const updated = { ...sampleTask, title: 'Updated' }
    mockUpdate.mockResolvedValueOnce(updated as never)
    const res = await putTask(
      makeTaskRouteRequest({ title: 'Updated' }),
      taskRouteCtx,
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.title).toBe('Updated')
  })
})

// ============================================================
// DELETE /api/tasks/[taskId]
// ============================================================

describe('DELETE /api/tasks/[taskId]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValueOnce(null as never)
    const res = await deleteTask(makeTaskRouteRequest(undefined, 'DELETE'), taskRouteCtx)
    expect(res.status).toBe(401)
  })

  it('returns 403 for HR role (not ADMIN)', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await deleteTask(makeTaskRouteRequest(undefined, 'DELETE'), taskRouteCtx)
    expect(res.status).toBe(403)
  })

  it('returns 403 for SUPERVISOR role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('SUPERVISOR') as never)
    const res = await deleteTask(makeTaskRouteRequest(undefined, 'DELETE'), taskRouteCtx)
    expect(res.status).toBe(403)
  })

  it('returns 404 when task does not exist', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockFindUnique.mockResolvedValueOnce(null as never)
    const res = await deleteTask(makeTaskRouteRequest(undefined, 'DELETE'), taskRouteCtx)
    expect(res.status).toBe(404)
  })

  it('returns 409 when task has UserTask completion records', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockFindUnique.mockResolvedValueOnce({
      id: 'task-1',
      _count: { userTasks: 3 },
    } as never)
    const res = await deleteTask(makeTaskRouteRequest(undefined, 'DELETE'), taskRouteCtx)
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toMatch(/completion records/)
  })

  it('deletes and returns 200 when task has no completion records', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockFindUnique.mockResolvedValueOnce({
      id: 'task-1',
      _count: { userTasks: 0 },
    } as never)
    mockDelete.mockResolvedValueOnce(sampleTask as never)
    const res = await deleteTask(makeTaskRouteRequest(undefined, 'DELETE'), taskRouteCtx)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.deleted).toBe(true)
  })
})

// ============================================================
// lib/validation unit tests
// ============================================================

import {
  validateTitle,
  validateDescription,
  validateAssignedRole,
  validateTaskType,
  validateOrder,
} from '@/lib/validation'

describe('validateTitle', () => {
  it('rejects undefined', () => expect(validateTitle(undefined)).not.toBeNull())
  it('rejects empty string', () => expect(validateTitle('')).not.toBeNull())
  it('rejects whitespace-only', () => expect(validateTitle('   ')).not.toBeNull())
  it('rejects 257-char string', () => expect(validateTitle('a'.repeat(257))).not.toBeNull())
  it('accepts valid title', () => expect(validateTitle('Sign the NDA')).toBeNull())
  it('accepts exactly 256 chars', () => expect(validateTitle('a'.repeat(256))).toBeNull())
})

describe('validateDescription', () => {
  it('accepts undefined', () => expect(validateDescription(undefined)).toBeNull())
  it('accepts null', () => expect(validateDescription(null)).toBeNull())
  it('accepts empty string', () => expect(validateDescription('')).toBeNull())
  it('rejects 2001-char string', () =>
    expect(validateDescription('x'.repeat(2001))).not.toBeNull())
  it('accepts exactly 2000 chars', () =>
    expect(validateDescription('x'.repeat(2000))).toBeNull())
  it('rejects non-string', () => expect(validateDescription(42)).not.toBeNull())
})

describe('validateAssignedRole', () => {
  it('rejects empty array', () => expect(validateAssignedRole([])).not.toBeNull())
  it('rejects non-array', () => expect(validateAssignedRole('USER')).not.toBeNull())
  it('rejects array with invalid role', () =>
    expect(validateAssignedRole(['GHOST'])).not.toBeNull())
  it('accepts valid single role', () => expect(validateAssignedRole(['USER'])).toBeNull())
  it('accepts all valid roles', () =>
    expect(validateAssignedRole(['USER', 'HR', 'ADMIN'])).toBeNull())
})

describe('validateTaskType', () => {
  it('accepts STANDARD', () => expect(validateTaskType('STANDARD')).toBeNull())
  it('accepts UPLOAD', () => expect(validateTaskType('UPLOAD')).toBeNull())
  it('accepts undefined (defaults applied by caller)', () =>
    expect(validateTaskType(undefined)).toBeNull())
  it('rejects unknown type', () => expect(validateTaskType('CHECKBOX')).not.toBeNull())
  it('rejects lowercase variant', () => expect(validateTaskType('standard')).not.toBeNull())
})

describe('validateOrder', () => {
  it('returns 0 for undefined', () => expect(validateOrder(undefined)).toBe(0))
  it('returns 0 for negative', () => expect(validateOrder(-5)).toBe(0))
  it('returns floor for float', () => expect(validateOrder(3.9)).toBe(3))
  it('returns 0 for NaN', () => expect(validateOrder(NaN)).toBe(0))
  it('returns value for valid integer', () => expect(validateOrder(10)).toBe(10))
})
