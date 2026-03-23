/**
 * Tests for the Resources feature:
 *   - POST /api/documents — sets isResource: true
 *   - GET /api/documents?type=resource — any authenticated user
 *   - GET /api/documents/[documentId]/download — Resource accessible by any user
 *   - POST /api/tasks — resourceDocumentId validation
 *   - PUT /api/tasks/[taskId] — resource update
 */

import { NextRequest } from 'next/server'

// ---- Module mocks ----

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/logger', () => ({ logError: jest.fn(), logAccess: jest.fn(), log: jest.fn() }))
jest.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    document: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    documentCategory: {
      findUnique: jest.fn(),
    },
    onboardingTask: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}))
jest.mock('@/lib/ratelimit', () => ({
  checkTaskMgmtRateLimit: jest.fn().mockResolvedValue(undefined),
  checkDocumentDownloadRateLimit: jest.fn().mockResolvedValue(undefined),
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
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { saveUpload } from '@/lib/upload'
import { readFile } from 'fs/promises'
import { GET as getDocuments, POST as postDocument } from '@/app/api/documents/route'
import { GET as downloadDocument } from '@/app/api/documents/[documentId]/download/route'
import { POST as postTask } from '@/app/api/tasks/route'
import { PUT as putTask } from '@/app/api/tasks/[taskId]/route'

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockUserFindUnique = prisma.user.findUnique as jest.MockedFunction<typeof prisma.user.findUnique>
const mockDocumentFindMany = prisma.document.findMany as jest.MockedFunction<typeof prisma.document.findMany>
const mockDocumentFindUnique = prisma.document.findUnique as jest.MockedFunction<typeof prisma.document.findUnique>
const mockDocumentCreate = prisma.document.create as jest.MockedFunction<typeof prisma.document.create>
const mockCategoryFindUnique = prisma.documentCategory.findUnique as jest.MockedFunction<typeof prisma.documentCategory.findUnique>
const mockTaskCreate = prisma.onboardingTask.create as jest.MockedFunction<typeof prisma.onboardingTask.create>
const mockTaskFindUnique = prisma.onboardingTask.findUnique as jest.MockedFunction<typeof prisma.onboardingTask.findUnique>
const mockTaskUpdate = prisma.onboardingTask.update as jest.MockedFunction<typeof prisma.onboardingTask.update>
const mockSaveUpload = saveUpload as jest.MockedFunction<typeof saveUpload>
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>

// ---- Constants ----

const VALID_DOC_ID = 'c111111111111111111111111'
const VALID_TASK_ID = 'c222222222222222222222222'
const USER_ID = 'c333333333333333333333333'
const UPLOADER_ID = 'c444444444444444444444444'

function makeSession(role: string, id = USER_ID) {
  return { user: { id, name: 'Test', email: 'test@test.com', role } }
}

const MOCK_RESOURCE_DOC = {
  id: VALID_DOC_ID,
  uploadedBy: UPLOADER_ID,
  filename: 'policy.pdf',
  storagePath: 'abcd1234-uuid.pdf',
  category: 'policy',
  uploadedAt: new Date(),
  isResource: true,
  uploader: { username: 'hruser' },
}

const MOCK_NON_RESOURCE_DOC = {
  ...MOCK_RESOURCE_DOC,
  isResource: false,
  category: 'task-upload',
}

const PDF_BUFFER = Buffer.from('%PDF-1.4 fake content')

// ---- Setup ----

beforeEach(() => {
  jest.clearAllMocks()
  mockUserFindUnique.mockResolvedValue({ active: true } as never)
  mockReadFile.mockResolvedValue(PDF_BUFFER as never)
  mockCategoryFindUnique.mockResolvedValue({ id: 'cat1' } as never)
})

// ---- POST /api/documents ----

describe('POST /api/documents — Resource creation', () => {
  function makeUploadRequest(): NextRequest {
    const formData = new FormData()
    const file = new File([PDF_BUFFER], 'policy.pdf', { type: 'application/pdf' })
    formData.append('file', file)
    formData.append('category', 'policy')
    return new NextRequest('http://localhost/api/documents', {
      method: 'POST',
      body: formData,
    })
  }

  beforeEach(() => {
    mockSaveUpload.mockResolvedValue({ storagePath: 'abcd1234-uuid.pdf', filename: 'policy.pdf' })
    mockDocumentCreate.mockResolvedValue(MOCK_RESOURCE_DOC as never)
  })

  it('returns 201 with isResource: true when HR uploads', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await postDocument(makeUploadRequest())
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.isResource).toBe(true)
  })

  it('returns 201 with isResource: true when PAYROLL uploads', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('PAYROLL') as never)
    const res = await postDocument(makeUploadRequest())
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.isResource).toBe(true)
  })

  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await postDocument(makeUploadRequest())
    expect(res.status).toBe(401)
  })

  it('returns 403 for USER role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    const res = await postDocument(makeUploadRequest())
    expect(res.status).toBe(403)
  })
})

// ---- GET /api/documents?type=resource ----

describe('GET /api/documents?type=resource — Resource listing', () => {
  function makeResourceListRequest(): NextRequest {
    return new NextRequest('http://localhost/api/documents?type=resource', { method: 'GET' })
  }

  beforeEach(() => {
    mockDocumentFindMany.mockResolvedValue([MOCK_RESOURCE_DOC] as never)
  })

  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await getDocuments(makeResourceListRequest())
    expect(res.status).toBe(401)
  })

  it('returns 200 for USER role — any authenticated user may list resources', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    const res = await getDocuments(makeResourceListRequest())
    expect(res.status).toBe(200)
  })

  it('returns 200 for ADMIN role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('ADMIN') as never)
    const res = await getDocuments(makeResourceListRequest())
    expect(res.status).toBe(200)
  })

  it('queries with isResource: true filter', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    await getDocuments(makeResourceListRequest())
    expect(mockDocumentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isResource: true } }),
    )
  })

  it('returns isResource field in each document', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    const res = await getDocuments(makeResourceListRequest())
    const body = await res.json()
    expect(body[0].isResource).toBe(true)
  })
})

// ---- GET /api/documents/[documentId]/download — Resource access ----

describe('GET /api/documents/[documentId]/download — Resource access', () => {
  function makeDownloadRequest(): NextRequest {
    return new NextRequest(
      `http://localhost/api/documents/${VALID_DOC_ID}/download`,
      { method: 'GET' },
    )
  }

  function makeContext(documentId = VALID_DOC_ID) {
    return { params: { documentId } }
  }

  it('returns 200 for USER role when document isResource: true', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    mockDocumentFindUnique.mockResolvedValueOnce(MOCK_RESOURCE_DOC as never)
    const res = await downloadDocument(makeDownloadRequest(), makeContext())
    expect(res.status).toBe(200)
  })

  it('returns 403 for USER role when document isResource: false and user is not uploader', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER', USER_ID) as never)
    mockDocumentFindUnique.mockResolvedValueOnce(MOCK_NON_RESOURCE_DOC as never)
    const res = await downloadDocument(makeDownloadRequest(), makeContext())
    expect(res.status).toBe(403)
  })

  it('returns 429 when rate limit is exceeded (resource doc)', async () => {
    const { checkDocumentDownloadRateLimit } = jest.requireMock('@/lib/ratelimit')
    checkDocumentDownloadRateLimit.mockRejectedValueOnce(new Error('Rate limit'))
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    mockDocumentFindUnique.mockResolvedValueOnce(MOCK_RESOURCE_DOC as never)
    const res = await downloadDocument(makeDownloadRequest(), makeContext())
    expect(res.status).toBe(429)
  })
})

// ---- POST /api/tasks — resourceDocumentId validation ----

describe('POST /api/tasks — resourceDocumentId handling', () => {
  function makeTaskRequest(body: object): NextRequest {
    return new NextRequest('http://localhost/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  const VALID_TASK_BODY = {
    title: 'Read the handbook',
    taskType: 'STANDARD',
    order: 1,
  }

  const MOCK_CREATED_TASK = {
    id: VALID_TASK_ID,
    title: 'Read the handbook',
    description: null,
    taskType: 'STANDARD',
    order: 1,
    resourceDocumentId: VALID_DOC_ID,
    resourceDocument: { id: VALID_DOC_ID, filename: 'policy.pdf' },
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  beforeEach(() => {
    mockDocumentFindUnique.mockResolvedValue({ isResource: true } as never)
    mockTaskCreate.mockResolvedValue(MOCK_CREATED_TASK as never)
  })

  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await postTask(makeTaskRequest({ ...VALID_TASK_BODY, resourceDocumentId: VALID_DOC_ID }))
    expect(res.status).toBe(401)
  })

  it('returns 403 for USER role', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('USER') as never)
    const res = await postTask(makeTaskRequest({ ...VALID_TASK_BODY, resourceDocumentId: VALID_DOC_ID }))
    expect(res.status).toBe(403)
  })

  it('returns 201 with valid resourceDocumentId pointing to a Resource', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await postTask(makeTaskRequest({ ...VALID_TASK_BODY, resourceDocumentId: VALID_DOC_ID }))
    expect(res.status).toBe(201)
  })

  it('returns 400 for invalid CUID format', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await postTask(makeTaskRequest({ ...VALID_TASK_BODY, resourceDocumentId: 'not-a-cuid' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/resourceDocumentId/)
  })

  it('returns 400 when document exists but isResource: false', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockDocumentFindUnique.mockResolvedValueOnce({ isResource: false } as never)
    const res = await postTask(makeTaskRequest({ ...VALID_TASK_BODY, resourceDocumentId: VALID_DOC_ID }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Resource/)
  })

  it('returns 400 when resourceDocumentId points to non-existent document', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockDocumentFindUnique.mockResolvedValueOnce(null)
    const res = await postTask(makeTaskRequest({ ...VALID_TASK_BODY, resourceDocumentId: VALID_DOC_ID }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Resource/)
  })

  it('returns 201 when resourceDocumentId is absent', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockTaskCreate.mockResolvedValue({ ...MOCK_CREATED_TASK, resourceDocumentId: null, resourceDocument: null } as never)
    const res = await postTask(makeTaskRequest(VALID_TASK_BODY))
    expect(res.status).toBe(201)
  })
})

// ---- PUT /api/tasks/[taskId] — resource update ----

describe('PUT /api/tasks/[taskId] — resource update', () => {
  function makeContext(taskId = VALID_TASK_ID) {
    return { params: { taskId } }
  }

  function makeUpdateRequest(body: object): NextRequest {
    return new NextRequest(`http://localhost/api/tasks/${VALID_TASK_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  const EXISTING_TASK = {
    id: VALID_TASK_ID,
    title: 'Existing task',
    description: null,
    taskType: 'STANDARD',
    order: 0,
    resourceDocumentId: null,
    resourceDocument: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  beforeEach(() => {
    mockTaskFindUnique.mockResolvedValue(EXISTING_TASK as never)
    mockDocumentFindUnique.mockResolvedValue({ isResource: true } as never)
    mockTaskUpdate.mockResolvedValue({
      ...EXISTING_TASK,
      resourceDocumentId: VALID_DOC_ID,
      resourceDocument: { id: VALID_DOC_ID, filename: 'policy.pdf' },
    } as never)
  })

  it('returns 200 when resourceDocumentId: null clears the resource', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockTaskUpdate.mockResolvedValueOnce({ ...EXISTING_TASK } as never)
    const res = await putTask(makeUpdateRequest({ resourceDocumentId: null }), makeContext())
    expect(res.status).toBe(200)
  })

  it('returns 200 when valid Resource ID is set', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    const res = await putTask(makeUpdateRequest({ resourceDocumentId: VALID_DOC_ID }), makeContext())
    expect(res.status).toBe(200)
  })

  it('returns 400 for non-Resource document ID', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockDocumentFindUnique.mockResolvedValueOnce({ isResource: false } as never)
    const res = await putTask(makeUpdateRequest({ resourceDocumentId: VALID_DOC_ID }), makeContext())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Resource/)
  })

  it('does not change resourceDocumentId when field is absent from body', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('HR') as never)
    mockTaskUpdate.mockResolvedValueOnce(EXISTING_TASK as never)
    await putTask(makeUpdateRequest({ title: 'Updated title' }), makeContext())
    const updateCall = mockTaskUpdate.mock.calls[0][0]
    expect(updateCall.data).not.toHaveProperty('resourceDocumentId')
  })
})
