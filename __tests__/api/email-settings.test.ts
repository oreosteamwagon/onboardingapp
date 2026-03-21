/**
 * Tests for GET/PUT /api/admin/email-settings and POST /api/admin/email-settings/test
 *
 * Covers:
 *   - Authentication: no session -> 401
 *   - Authorization: non-ADMIN role -> 403
 *   - GET: returns settings with passwordSet flag, never returns raw password
 *   - GET: returns Entra fields with entraClientSecretSet flag, never returns secret
 *   - PUT: input validation (host, port, secure, fromAddress, fromName) for SMTP
 *   - PUT: input validation (entraTenantId, entraClientId GUID format) for ENTRA
 *   - PUT: valid SMTP payload -> 200 with passwordSet flag
 *   - PUT: valid ENTRA payload -> 200 with entraClientSecretSet flag
 *   - PUT: password omitted -> existing password preserved
 *   - PUT: entraClientSecret omitted -> existing secret preserved
 *   - PUT: invalidateEntraTokenCache called on every save
 *   - POST /test: email not enabled -> 409
 *   - POST /test: SMTP error -> 502
 *   - POST /test: success -> 200
 *   - POST /test: ENTRA with missing secret -> 409
 *   - Rate limit exceeded -> 429
 */

import { NextRequest } from 'next/server'

// ---- Module mocks ----

jest.mock('@/lib/auth', () => ({ auth: jest.fn() }))
jest.mock('@/lib/db', () => ({
  prisma: {
    emailSetting: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  },
}))
jest.mock('@/lib/ratelimit', () => ({
  checkEmailSettingsRateLimit: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/encrypt', () => ({
  encryptSmtpPassword: jest.fn().mockReturnValue('iv:tag:cipher'),
  decryptSmtpPassword: jest.fn().mockReturnValue('plaintext'),
  encryptEntraClientSecret: jest.fn().mockReturnValue('iv:tag:entracipher'),
  decryptEntraClientSecret: jest.fn().mockReturnValue('entrasecretplain'),
}))
jest.mock('@/lib/email', () => ({
  sendTestEmail: jest.fn().mockResolvedValue(undefined),
  invalidateEntraTokenCache: jest.fn(),
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { checkEmailSettingsRateLimit } from '@/lib/ratelimit'
import { encryptSmtpPassword, encryptEntraClientSecret } from '@/lib/encrypt'
import { sendTestEmail, invalidateEntraTokenCache } from '@/lib/email'
import { GET, PUT } from '@/app/api/admin/email-settings/route'
import { POST as testPOST } from '@/app/api/admin/email-settings/test/route'

const mockAuth = auth as jest.MockedFunction<typeof auth>
const mockFindUnique = prisma.emailSetting.findUnique as jest.MockedFunction<typeof prisma.emailSetting.findUnique>
const mockUpsert = prisma.emailSetting.upsert as jest.MockedFunction<typeof prisma.emailSetting.upsert>
const mockUserFindUnique = prisma.user.findUnique as jest.MockedFunction<typeof prisma.user.findUnique>
const mockCheckRateLimit = checkEmailSettingsRateLimit as jest.MockedFunction<typeof checkEmailSettingsRateLimit>
const mockEncrypt = encryptSmtpPassword as jest.MockedFunction<typeof encryptSmtpPassword>
const mockEncryptEntra = encryptEntraClientSecret as jest.MockedFunction<typeof encryptEntraClientSecret>
const mockSendTestEmail = sendTestEmail as jest.MockedFunction<typeof sendTestEmail>
const mockInvalidateEntraCache = invalidateEntraTokenCache as jest.MockedFunction<typeof invalidateEntraTokenCache>

// ---- Helpers ----

function makeAdminSession(id = 'admin-1') {
  return { user: { id, name: 'Admin', email: 'admin@test.com', role: 'ADMIN' } }
}

function makeSession(role: string, id = 'user-1') {
  return { user: { id, name: 'Test', email: 'test@test.com', role } }
}

function makeGetRequest(): NextRequest {
  return new NextRequest('http://localhost/api/admin/email-settings', { method: 'GET' })
}

function makePutRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/email-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeTestPostRequest(): NextRequest {
  return new NextRequest('http://localhost/api/admin/email-settings/test', { method: 'POST' })
}

const validPayload = {
  enabled: true,
  provider: 'SMTP',
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  username: 'user@example.com',
  password: 'secret123',
  fromAddress: 'noreply@example.com',
  fromName: 'OnboardingApp',
}

const validEntraPayload = {
  enabled: true,
  provider: 'ENTRA',
  entraTenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  entraClientId: '11111111-2222-3333-4444-555555555555',
  entraClientSecret: 'supersecretvalue',
  fromAddress: 'noreply@example.com',
  fromName: 'OnboardingApp',
}

const mockSetting = {
  id: 'global',
  enabled: true,
  provider: 'SMTP',
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  username: 'user@example.com',
  passwordEnc: 'iv:tag:cipher',
  entraTenantId: '',
  entraClientId: '',
  entraClientSecretEnc: '',
  fromAddress: 'noreply@example.com',
  fromName: 'OnboardingApp',
  updatedAt: new Date(),
}

const mockEntraSetting = {
  id: 'global',
  enabled: true,
  provider: 'ENTRA',
  host: '',
  port: 587,
  secure: false,
  username: '',
  passwordEnc: '',
  entraTenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  entraClientId: '11111111-2222-3333-4444-555555555555',
  entraClientSecretEnc: 'iv:tag:entracipher',
  fromAddress: 'noreply@example.com',
  fromName: 'OnboardingApp',
  updatedAt: new Date(),
}

// ---- GET tests ----

describe('GET /api/admin/email-settings', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-ADMIN role', async () => {
    for (const role of ['USER', 'SUPERVISOR', 'PAYROLL', 'HR']) {
      mockAuth.mockResolvedValueOnce(makeSession(role) as never)
      const res = await GET()
      expect(res.status).toBe(403)
    }
  })

  it('returns default values when no setting exists', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce(null)
    const res = await GET()
    expect(res.status).toBe(200)
    const data = await res.json() as Record<string, unknown>
    expect(data.enabled).toBe(false)
    expect(data.provider).toBe('SMTP')
    expect(data.port).toBe(587)
    expect(data.passwordSet).toBe(false)
    expect(data.entraClientSecretSet).toBe(false)
    expect(data).not.toHaveProperty('passwordEnc')
    expect(data).not.toHaveProperty('entraClientSecretEnc')
  })

  it('returns settings with passwordSet=true when password is stored, never returns raw password', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce(mockSetting as never)
    const res = await GET()
    expect(res.status).toBe(200)
    const data = await res.json() as Record<string, unknown>
    expect(data.passwordSet).toBe(true)
    expect(data).not.toHaveProperty('passwordEnc')
    expect(data).not.toHaveProperty('password')
    expect(data.host).toBe('smtp.example.com')
    expect(data.port).toBe(587)
  })

  it('returns entraClientSecretSet=true when secret is stored, never returns raw secret', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce(mockEntraSetting as never)
    const res = await GET()
    expect(res.status).toBe(200)
    const data = await res.json() as Record<string, unknown>
    expect(data.provider).toBe('ENTRA')
    expect(data.entraClientSecretSet).toBe(true)
    expect(data).not.toHaveProperty('entraClientSecretEnc')
    expect(data.entraTenantId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(data.entraClientId).toBe('11111111-2222-3333-4444-555555555555')
  })
})

// ---- PUT tests (SMTP provider) ----

describe('PUT /api/admin/email-settings (SMTP)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await PUT(makePutRequest(validPayload))
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-ADMIN role', async () => {
    for (const role of ['USER', 'SUPERVISOR', 'PAYROLL', 'HR']) {
      mockAuth.mockResolvedValueOnce(makeSession(role) as never)
      const res = await PUT(makePutRequest(validPayload))
      expect(res.status).toBe(403)
    }
  })

  it('returns 429 when rate limit exceeded', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockCheckRateLimit.mockRejectedValueOnce(new Error('Rate limit'))
    const res = await PUT(makePutRequest(validPayload))
    expect(res.status).toBe(429)
  })

  it('returns 400 for missing enabled field', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const { enabled: _e, ...noEnabled } = validPayload
    const res = await PUT(makePutRequest(noEnabled))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid provider', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await PUT(makePutRequest({ ...validPayload, provider: 'INVALID' }))
    expect(res.status).toBe(400)
    const data = await res.json() as { errors: string[] }
    expect(data.errors.some((e) => e.includes('provider'))).toBe(true)
  })

  it('returns 400 for invalid host', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await PUT(makePutRequest({ ...validPayload, host: '' }))
    expect(res.status).toBe(400)
    const data = await res.json() as { errors: string[] }
    expect(data.errors.some((e) => e.includes('host'))).toBe(true)
  })

  it('returns 400 for invalid port', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await PUT(makePutRequest({ ...validPayload, port: 9999 }))
    expect(res.status).toBe(400)
    const data = await res.json() as { errors: string[] }
    expect(data.errors.some((e) => e.includes('port'))).toBe(true)
  })

  it('returns 400 for invalid fromAddress', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await PUT(makePutRequest({ ...validPayload, fromAddress: 'not-an-email' }))
    expect(res.status).toBe(400)
    const data = await res.json() as { errors: string[] }
    expect(data.errors.some((e) => e.includes('fromAddress'))).toBe(true)
  })

  it('returns 400 for empty fromName', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await PUT(makePutRequest({ ...validPayload, fromName: '' }))
    expect(res.status).toBe(400)
    const data = await res.json() as { errors: string[] }
    expect(data.errors.some((e) => e.includes('fromName'))).toBe(true)
  })

  it('saves and encrypts SMTP password when provided', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce(null)
    mockUpsert.mockResolvedValueOnce({ ...mockSetting } as never)
    const res = await PUT(makePutRequest(validPayload))
    expect(res.status).toBe(200)
    expect(mockEncrypt).toHaveBeenCalledWith('secret123')
    const data = await res.json() as { passwordSet: boolean }
    expect(data.passwordSet).toBe(true)
  })

  it('preserves existing password when password field is empty', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce(mockSetting as never)
    mockUpsert.mockResolvedValueOnce({ ...mockSetting } as never)
    const res = await PUT(makePutRequest({ ...validPayload, password: '' }))
    expect(res.status).toBe(200)
    expect(mockEncrypt).not.toHaveBeenCalled()
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.not.objectContaining({ passwordEnc: expect.anything() }),
      }),
    )
  })

  it('calls invalidateEntraTokenCache on successful SMTP save', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce(null)
    mockUpsert.mockResolvedValueOnce({ ...mockSetting } as never)
    await PUT(makePutRequest(validPayload))
    expect(mockInvalidateEntraCache).toHaveBeenCalled()
  })

  it('returns valid response shape without sensitive fields', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce(null)
    mockUpsert.mockResolvedValueOnce({ ...mockSetting } as never)
    const res = await PUT(makePutRequest(validPayload))
    const data = await res.json() as Record<string, unknown>
    expect(data).not.toHaveProperty('passwordEnc')
    expect(data).not.toHaveProperty('password')
    expect(data).not.toHaveProperty('entraClientSecretEnc')
    expect(data).toHaveProperty('passwordSet')
    expect(data).toHaveProperty('entraClientSecretSet')
    expect(data).toHaveProperty('host')
    expect(data).toHaveProperty('port')
    expect(data).toHaveProperty('fromAddress')
    expect(data).toHaveProperty('fromName')
  })
})

// ---- PUT tests (ENTRA provider) ----

describe('PUT /api/admin/email-settings (ENTRA)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 400 for invalid entraTenantId (not a GUID)', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await PUT(makePutRequest({ ...validEntraPayload, entraTenantId: 'not-a-guid' }))
    expect(res.status).toBe(400)
    const data = await res.json() as { errors: string[] }
    expect(data.errors.some((e) => e.includes('entraTenantId'))).toBe(true)
  })

  it('returns 400 for invalid entraClientId (not a GUID)', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await PUT(makePutRequest({ ...validEntraPayload, entraClientId: 'not-a-guid' }))
    expect(res.status).toBe(400)
    const data = await res.json() as { errors: string[] }
    expect(data.errors.some((e) => e.includes('entraClientId'))).toBe(true)
  })

  it('returns 400 for entraClientSecret exceeding max length', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await PUT(makePutRequest({ ...validEntraPayload, entraClientSecret: 'x'.repeat(257) }))
    expect(res.status).toBe(400)
    const data = await res.json() as { errors: string[] }
    expect(data.errors.some((e) => e.includes('entraClientSecret'))).toBe(true)
  })

  it('returns 400 for missing fromAddress with ENTRA provider', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    const res = await PUT(makePutRequest({ ...validEntraPayload, fromAddress: '' }))
    expect(res.status).toBe(400)
    const data = await res.json() as { errors: string[] }
    expect(data.errors.some((e) => e.includes('fromAddress'))).toBe(true)
  })

  it('does not require SMTP host when provider is ENTRA', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce(null)
    mockUpsert.mockResolvedValueOnce({ ...mockEntraSetting } as never)
    // No host field in payload — should succeed
    const res = await PUT(makePutRequest(validEntraPayload))
    expect(res.status).toBe(200)
  })

  it('encrypts Entra client secret when provided', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce(null)
    mockUpsert.mockResolvedValueOnce({ ...mockEntraSetting } as never)
    const res = await PUT(makePutRequest(validEntraPayload))
    expect(res.status).toBe(200)
    expect(mockEncryptEntra).toHaveBeenCalledWith('supersecretvalue')
    const data = await res.json() as { entraClientSecretSet: boolean; provider: string }
    expect(data.provider).toBe('ENTRA')
    expect(data.entraClientSecretSet).toBe(true)
  })

  it('preserves existing Entra secret when entraClientSecret is empty', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce(mockEntraSetting as never)
    mockUpsert.mockResolvedValueOnce({ ...mockEntraSetting } as never)
    const res = await PUT(makePutRequest({ ...validEntraPayload, entraClientSecret: '' }))
    expect(res.status).toBe(200)
    expect(mockEncryptEntra).not.toHaveBeenCalled()
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.not.objectContaining({ entraClientSecretEnc: expect.anything() }),
      }),
    )
  })

  it('calls invalidateEntraTokenCache on successful ENTRA save', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce(null)
    mockUpsert.mockResolvedValueOnce({ ...mockEntraSetting } as never)
    await PUT(makePutRequest(validEntraPayload))
    expect(mockInvalidateEntraCache).toHaveBeenCalled()
  })
})

// ---- POST /test tests ----

describe('POST /api/admin/email-settings/test', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await testPOST(makeTestPostRequest())
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-ADMIN role', async () => {
    for (const role of ['USER', 'SUPERVISOR', 'PAYROLL', 'HR']) {
      mockAuth.mockResolvedValueOnce(makeSession(role) as never)
      const res = await testPOST(makeTestPostRequest())
      expect(res.status).toBe(403)
    }
  })

  it('returns 409 when email is not enabled', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce({ ...mockSetting, enabled: false } as never)
    const res = await testPOST(makeTestPostRequest())
    expect(res.status).toBe(409)
  })

  it('returns 409 when setting does not exist', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce(null)
    const res = await testPOST(makeTestPostRequest())
    expect(res.status).toBe(409)
  })

  it('returns 409 when SMTP host is missing', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce({ ...mockSetting, host: '' } as never)
    const res = await testPOST(makeTestPostRequest())
    expect(res.status).toBe(409)
  })

  it('returns 409 when ENTRA tenantId is missing', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce({ ...mockEntraSetting, entraTenantId: '' } as never)
    const res = await testPOST(makeTestPostRequest())
    expect(res.status).toBe(409)
  })

  it('returns 409 when ENTRA client secret is missing', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce({ ...mockEntraSetting, entraClientSecretEnc: '' } as never)
    const res = await testPOST(makeTestPostRequest())
    expect(res.status).toBe(409)
  })

  it('returns 502 when SMTP send fails', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce(mockSetting as never)
    mockUserFindUnique.mockResolvedValueOnce({ email: 'admin@test.com' } as never)
    mockSendTestEmail.mockRejectedValueOnce(new Error('Connection refused'))
    const res = await testPOST(makeTestPostRequest())
    expect(res.status).toBe(502)
    const data = await res.json() as { error: string }
    expect(data.error).toContain('Connection refused')
  })

  it('returns 200 and to address on success', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockFindUnique.mockResolvedValueOnce(mockSetting as never)
    mockUserFindUnique.mockResolvedValueOnce({ email: 'admin@test.com' } as never)
    mockSendTestEmail.mockResolvedValueOnce(undefined)
    const res = await testPOST(makeTestPostRequest())
    expect(res.status).toBe(200)
    const data = await res.json() as { sent: boolean; to: string }
    expect(data.sent).toBe(true)
    expect(data.to).toBe('admin@test.com')
  })

  it('returns 429 when rate limit exceeded', async () => {
    mockAuth.mockResolvedValueOnce(makeAdminSession() as never)
    mockCheckRateLimit.mockRejectedValueOnce(new Error('Rate limit'))
    const res = await testPOST(makeTestPostRequest())
    expect(res.status).toBe(429)
  })
})
