/**
 * Tests for GET /api/team-tasks
 *
 * Covers:
 *   - Authentication: no session -> 401
 *   - Authorization: USER role -> 403; SUPERVISOR, HR, PAYROLL, ADMIN -> 200
 *   - Scope enforcement: SUPERVISOR sees only their assigned workflows
 *   - Completion percentage calculation (integer rounding)
 *   - Pending approval count calculation
 *   - Empty assignments -> empty array
 *   - Rate limit exceeded -> 429
 */

import { NextRequest } from 'next/server'

// ---- Module mocks ----

jest.mock('@/lib/auth')
jest.mock('@/lib/db', () => ({
  prisma: {
    userWorkflow: { findMany: jest.fn() },
    userTask: { findMany: jest.fn() },
  },
}))
jest.mock('@/lib/ratelimit', () => ({
  checkTeamTasksRateLimit: jest.fn().mockResolvedValue(undefined),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { checkTeamTasksRateLimit } from '@/lib/ratelimit'
import { GET } from '@/app/api/team-tasks/route'

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockUserWorkflowFindMany = prisma.userWorkflow.findMany as jest.MockedFunction<
  typeof prisma.userWorkflow.findMany
>
const mockUserTaskFindMany = prisma.userTask.findMany as jest.MockedFunction<
  typeof prisma.userTask.findMany
>
const mockCheckRateLimit = checkTeamTasksRateLimit as jest.MockedFunction<
  typeof checkTeamTasksRateLimit
>

// ---- Helpers ----

function makeSession(role: string, id = 'user-supervisor-1') {
  return { user: { id, name: 'Test', email: 'test@test.com', role } }
}

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/team-tasks', { method: 'GET' })
}

// Minimal UserWorkflow rows returned by prisma mock
function makeAssignment(
  overrides: {
    id?: string
    userId?: string
    workflowId?: string
    supervisorId?: string | null
    username?: string
    workflowName?: string
    taskIds?: string[]
  } = {},
) {
  return {
    id: overrides.id ?? 'uw-1',
    userId: overrides.userId ?? 'u-1',
    workflowId: overrides.workflowId ?? 'wf-1',
    supervisorId: overrides.supervisorId ?? null,
    assignedAt: new Date('2024-01-01'),
    user: { id: overrides.userId ?? 'u-1', username: overrides.username ?? 'alice' },
    workflow: {
      id: overrides.workflowId ?? 'wf-1',
      name: overrides.workflowName ?? 'Onboarding',
      tasks: (overrides.taskIds ?? ['task-1', 'task-2']).map((taskId) => ({ taskId })),
    },
  }
}

// ---- Tests ----

beforeEach(() => {
  jest.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(undefined)
})

describe('GET /api/team-tasks — authentication', () => {
  it('returns 401 when no session exists', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await GET()
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })
})

describe('GET /api/team-tasks — authorization', () => {
  it('returns 403 for USER role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    const res = await GET()
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('Forbidden')
  })

  it('returns 200 for SUPERVISOR role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('SUPERVISOR') as never)
    mockUserWorkflowFindMany.mockResolvedValueOnce([])
    const res = await GET()
    expect(res.status).toBe(200)
  })

  it('returns 200 for HR role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockUserWorkflowFindMany.mockResolvedValueOnce([])
    const res = await GET()
    expect(res.status).toBe(200)
  })

  it('returns 200 for PAYROLL role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('PAYROLL') as never)
    mockUserWorkflowFindMany.mockResolvedValueOnce([])
    const res = await GET()
    expect(res.status).toBe(200)
  })

  it('returns 200 for ADMIN role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockUserWorkflowFindMany.mockResolvedValueOnce([])
    const res = await GET()
    expect(res.status).toBe(200)
  })
})

describe('GET /api/team-tasks — scope enforcement', () => {
  it('scopes SUPERVISOR query to their supervisorId', async () => {
    const supervisorId = 'supervisor-99'
    mockAuth.mockResolvedValueOnce(makeSession('SUPERVISOR', supervisorId) as never)
    mockUserWorkflowFindMany.mockResolvedValueOnce([])

    await GET()

    expect(mockUserWorkflowFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { supervisorId },
      }),
    )
  })

  it('ADMIN query uses empty where clause (all assignments)', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN', 'admin-1') as never)
    mockUserWorkflowFindMany.mockResolvedValueOnce([])

    await GET()

    expect(mockUserWorkflowFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    )
  })

  it('HR query uses empty where clause (all assignments)', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR', 'hr-1') as never)
    mockUserWorkflowFindMany.mockResolvedValueOnce([])

    await GET()

    expect(mockUserWorkflowFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    )
  })

  it('PAYROLL query uses empty where clause (all assignments)', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('PAYROLL', 'payroll-1') as never)
    mockUserWorkflowFindMany.mockResolvedValueOnce([])

    await GET()

    expect(mockUserWorkflowFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    )
  })
})

describe('GET /api/team-tasks — empty assignments', () => {
  it('returns an empty array when no assignments exist', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockUserWorkflowFindMany.mockResolvedValueOnce([])

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([])
    // UserTask query should NOT be called when there are no assignments
    expect(mockUserTaskFindMany).not.toHaveBeenCalled()
  })
})

describe('GET /api/team-tasks — completion percentage', () => {
  it('calculates 0% when no tasks are completed', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockUserWorkflowFindMany.mockResolvedValueOnce([
      makeAssignment({ taskIds: ['t-1', 't-2', 't-3'] }),
    ])
    mockUserTaskFindMany.mockResolvedValueOnce([
      { userId: 'u-1', taskId: 't-1', completed: false, approvalStatus: 'PENDING' },
      { userId: 'u-1', taskId: 't-2', completed: false, approvalStatus: 'PENDING' },
      { userId: 'u-1', taskId: 't-3', completed: false, approvalStatus: 'PENDING' },
    ] as never)

    const res = await GET()
    const body = await res.json()
    expect(body[0].workflows[0].completionPct).toBe(0)
    expect(body[0].workflows[0].completedTasks).toBe(0)
    expect(body[0].workflows[0].totalTasks).toBe(3)
  })

  it('calculates 100% when all tasks are completed', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockUserWorkflowFindMany.mockResolvedValueOnce([
      makeAssignment({ taskIds: ['t-1', 't-2'] }),
    ])
    mockUserTaskFindMany.mockResolvedValueOnce([
      { userId: 'u-1', taskId: 't-1', completed: true, approvalStatus: 'APPROVED' },
      { userId: 'u-1', taskId: 't-2', completed: true, approvalStatus: 'APPROVED' },
    ] as never)

    const res = await GET()
    const body = await res.json()
    expect(body[0].workflows[0].completionPct).toBe(100)
    expect(body[0].workflows[0].completedTasks).toBe(2)
  })

  it('calculates partial completion with integer rounding', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockUserWorkflowFindMany.mockResolvedValueOnce([
      makeAssignment({ taskIds: ['t-1', 't-2', 't-3'] }),
    ])
    mockUserTaskFindMany.mockResolvedValueOnce([
      { userId: 'u-1', taskId: 't-1', completed: true, approvalStatus: 'APPROVED' },
      { userId: 'u-1', taskId: 't-2', completed: false, approvalStatus: 'PENDING' },
      { userId: 'u-1', taskId: 't-3', completed: false, approvalStatus: 'PENDING' },
    ] as never)

    const res = await GET()
    const body = await res.json()
    // 1/3 = 33.33... -> rounds to 33
    expect(body[0].workflows[0].completionPct).toBe(33)
    expect(body[0].workflows[0].completedTasks).toBe(1)
  })

  it('returns 0% for a workflow with no tasks', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockUserWorkflowFindMany.mockResolvedValueOnce([
      makeAssignment({ taskIds: [] }),
    ])
    mockUserTaskFindMany.mockResolvedValueOnce([] as never)

    const res = await GET()
    const body = await res.json()
    expect(body[0].workflows[0].completionPct).toBe(0)
    expect(body[0].workflows[0].totalTasks).toBe(0)
  })
})

describe('GET /api/team-tasks — pending approval count', () => {
  it('counts only completed tasks with PENDING approval status', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockUserWorkflowFindMany.mockResolvedValueOnce([
      makeAssignment({ taskIds: ['t-1', 't-2', 't-3', 't-4'] }),
    ])
    mockUserTaskFindMany.mockResolvedValueOnce([
      { userId: 'u-1', taskId: 't-1', completed: true, approvalStatus: 'PENDING' },
      { userId: 'u-1', taskId: 't-2', completed: true, approvalStatus: 'APPROVED' },
      { userId: 'u-1', taskId: 't-3', completed: true, approvalStatus: 'PENDING' },
      { userId: 'u-1', taskId: 't-4', completed: false, approvalStatus: 'PENDING' },
    ] as never)

    const res = await GET()
    const body = await res.json()
    // t-1 and t-3 are completed + PENDING; t-4 not completed so excluded
    expect(body[0].workflows[0].pendingApprovalCount).toBe(2)
  })

  it('does not count non-completed tasks as pending', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockUserWorkflowFindMany.mockResolvedValueOnce([
      makeAssignment({ taskIds: ['t-1'] }),
    ])
    mockUserTaskFindMany.mockResolvedValueOnce([
      { userId: 'u-1', taskId: 't-1', completed: false, approvalStatus: 'PENDING' },
    ] as never)

    const res = await GET()
    const body = await res.json()
    expect(body[0].workflows[0].pendingApprovalCount).toBe(0)
  })
})

describe('GET /api/team-tasks — response shape', () => {
  it('groups multiple workflows per user correctly', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockUserWorkflowFindMany.mockResolvedValueOnce([
      makeAssignment({
        id: 'uw-1',
        userId: 'u-1',
        workflowId: 'wf-1',
        username: 'alice',
        workflowName: 'Workflow A',
        taskIds: ['t-1'],
      }),
      makeAssignment({
        id: 'uw-2',
        userId: 'u-1',
        workflowId: 'wf-2',
        username: 'alice',
        workflowName: 'Workflow B',
        taskIds: ['t-2', 't-3'],
      }),
    ])
    mockUserTaskFindMany.mockResolvedValueOnce([
      { userId: 'u-1', taskId: 't-1', completed: true, approvalStatus: 'APPROVED' },
      { userId: 'u-1', taskId: 't-2', completed: true, approvalStatus: 'PENDING' },
      { userId: 'u-1', taskId: 't-3', completed: false, approvalStatus: 'PENDING' },
    ] as never)

    const res = await GET()
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].userId).toBe('u-1')
    expect(body[0].username).toBe('alice')
    expect(body[0].workflows).toHaveLength(2)

    const wfA = body[0].workflows.find((w: { workflowName: string }) => w.workflowName === 'Workflow A')
    expect(wfA.completionPct).toBe(100)

    const wfB = body[0].workflows.find((w: { workflowName: string }) => w.workflowName === 'Workflow B')
    expect(wfB.completionPct).toBe(50)
    expect(wfB.pendingApprovalCount).toBe(1)
  })

  it('separates two distinct users into two entries', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockUserWorkflowFindMany.mockResolvedValueOnce([
      makeAssignment({ id: 'uw-1', userId: 'u-1', username: 'alice', taskIds: ['t-1'] }),
      makeAssignment({ id: 'uw-2', userId: 'u-2', username: 'bob', taskIds: ['t-2'] }),
    ])
    mockUserTaskFindMany.mockResolvedValueOnce([
      { userId: 'u-1', taskId: 't-1', completed: true, approvalStatus: 'APPROVED' },
      { userId: 'u-2', taskId: 't-2', completed: false, approvalStatus: 'PENDING' },
    ] as never)

    const res = await GET()
    const body = await res.json()
    expect(body).toHaveLength(2)
    const alice = body.find((u: { username: string }) => u.username === 'alice')
    const bob = body.find((u: { username: string }) => u.username === 'bob')
    expect(alice.workflows[0].completionPct).toBe(100)
    expect(bob.workflows[0].completionPct).toBe(0)
  })
})

describe('GET /api/team-tasks — rate limiting', () => {
  it('returns 429 when rate limit is exceeded', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    mockCheckRateLimit.mockRejectedValueOnce(new Error('Rate limit exceeded'))

    const res = await GET()
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toBe('Too many requests')
  })

  it('passes the authenticated user id to the rate limiter', async () => {
    const userId = 'specific-user-id'
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN', userId) as never)
    mockUserWorkflowFindMany.mockResolvedValueOnce([])

    await GET()

    expect(mockCheckRateLimit).toHaveBeenCalledWith(userId)
  })
})
