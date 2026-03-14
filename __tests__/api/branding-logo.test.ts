/**
 * Tests for GET /api/branding/logo
 *
 * Covers:
 *   - Rate limiting: 429 when IP exceeds limit
 *   - No logo configured: 404
 *   - Suspicious storagePath (path traversal chars): 500
 *   - Non-image extension in storagePath: 500
 *   - File not on disk: 404
 *   - Success: correct Content-Type, Cache-Control, X-Content-Type-Options, Content-Length
 *   - IP extraction: x-forwarded-for takes priority over x-real-ip
 */

import { NextRequest } from 'next/server'

// ---- Module mocks ----

jest.mock('@/lib/db', () => ({
  prisma: {
    brandingSetting: {
      findFirst: jest.fn(),
    },
  },
}))
jest.mock('@/lib/ratelimit', () => ({
  checkLogoRateLimit: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}))

import { prisma } from '@/lib/db'
import { checkLogoRateLimit } from '@/lib/ratelimit'
import { readFile } from 'fs/promises'
import { GET } from '@/app/api/branding/logo/route'

const mockFindFirst = prisma.brandingSetting.findFirst as jest.MockedFunction<
  typeof prisma.brandingSetting.findFirst
>
const mockCheckRateLimit = checkLogoRateLimit as jest.MockedFunction<
  typeof checkLogoRateLimit
>
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>

// ---- Helpers ----

const PNG_BUFFER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const VALID_STORAGE_PATH = 'a1b2c3d4-0000-0000-0000-000000000000.png'

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/branding/logo', {
    method: 'GET',
    headers,
  })
}

// ---- Setup ----

beforeEach(() => {
  jest.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(undefined)
  mockReadFile.mockResolvedValue(PNG_BUFFER as never)
  mockFindFirst.mockResolvedValue({ logoPath: VALID_STORAGE_PATH } as never)
})

// ---- Rate limiting ----

describe('GET /api/branding/logo — rate limiting', () => {
  it('returns 429 when rate limit is exceeded', async () => {
    mockCheckRateLimit.mockRejectedValueOnce(new Error('Rate limit exceeded'))
    const res = await GET(makeRequest({ 'x-forwarded-for': '10.0.0.1' }))
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('Too many requests')
  })

  it('keys rate limit on the first IP in x-forwarded-for', async () => {
    await GET(makeRequest({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }))
    expect(mockCheckRateLimit).toHaveBeenCalledWith('203.0.113.5')
  })

  it('falls back to x-real-ip when x-forwarded-for is absent', async () => {
    await GET(makeRequest({ 'x-real-ip': '198.51.100.7' }))
    expect(mockCheckRateLimit).toHaveBeenCalledWith('198.51.100.7')
  })

  it('falls back to "unknown" when no IP headers are present', async () => {
    await GET(makeRequest())
    expect(mockCheckRateLimit).toHaveBeenCalledWith('unknown')
  })
})

// ---- No logo configured ----

describe('GET /api/branding/logo — no logo configured', () => {
  it('returns 404 when branding record does not exist', async () => {
    mockFindFirst.mockResolvedValueOnce(null)
    const res = await GET(makeRequest())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('No logo configured')
  })

  it('returns 404 when logoPath is null', async () => {
    mockFindFirst.mockResolvedValueOnce({ logoPath: null } as never)
    const res = await GET(makeRequest())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('No logo configured')
  })

  it('returns 404 when logoPath is an empty string', async () => {
    mockFindFirst.mockResolvedValueOnce({ logoPath: '' } as never)
    const res = await GET(makeRequest())
    expect(res.status).toBe(404)
  })
})

// ---- Path traversal guard ----

describe('GET /api/branding/logo — path traversal guard', () => {
  it('returns 500 when logoPath contains a forward slash', async () => {
    mockFindFirst.mockResolvedValueOnce({ logoPath: '../uploads/evil.png' } as never)
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
  })

  it('returns 500 when logoPath contains a backslash', async () => {
    mockFindFirst.mockResolvedValueOnce({ logoPath: 'sub\\evil.png' } as never)
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
  })

  it('returns 500 when logoPath contains double-dot', async () => {
    mockFindFirst.mockResolvedValueOnce({ logoPath: 'valid..png' } as never)
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
  })
})

// ---- Extension allowlist ----

describe('GET /api/branding/logo — extension allowlist', () => {
  it('returns 500 for a PDF extension', async () => {
    mockFindFirst.mockResolvedValueOnce({ logoPath: 'uuid.pdf' } as never)
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
  })

  it('returns 500 for an unknown extension', async () => {
    mockFindFirst.mockResolvedValueOnce({ logoPath: 'uuid.exe' } as never)
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
  })

  it('returns 500 for a DOCX extension', async () => {
    mockFindFirst.mockResolvedValueOnce({ logoPath: 'uuid.docx' } as never)
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
  })
})

// ---- File not found on disk ----

describe('GET /api/branding/logo — file read', () => {
  it('returns 404 when the file does not exist on disk', async () => {
    mockReadFile.mockRejectedValueOnce(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    )
    const res = await GET(makeRequest())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Logo file not found')
  })
})

// ---- Success response ----

describe('GET /api/branding/logo — success', () => {
  it('returns 200 with the logo buffer', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = Buffer.from(await res.arrayBuffer())
    expect(body).toEqual(PNG_BUFFER)
  })

  it('sets Content-Type to image/png for .png logos', async () => {
    const res = await GET(makeRequest())
    expect(res.headers.get('Content-Type')).toBe('image/png')
  })

  it('sets Content-Type to image/jpeg for .jpg logos', async () => {
    mockFindFirst.mockResolvedValueOnce({
      logoPath: 'uuid.jpg',
    } as never)
    const res = await GET(makeRequest())
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
  })

  it('sets Cache-Control to public, max-age=3600', async () => {
    const res = await GET(makeRequest())
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600')
  })

  it('sets X-Content-Type-Options to nosniff', async () => {
    const res = await GET(makeRequest())
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('sets Content-Length matching the buffer size', async () => {
    const res = await GET(makeRequest())
    expect(res.headers.get('Content-Length')).toBe(String(PNG_BUFFER.length))
  })
})
