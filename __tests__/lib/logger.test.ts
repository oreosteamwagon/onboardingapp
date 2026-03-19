/**
 * Tests for lib/logger.ts
 *
 * Covers:
 *   - Message prefix for each level
 *   - JSON output with required fields
 *   - LOG_LEVEL env var filtering (ERROR, ACCESS, LOG/unset)
 *   - Meta scrubbing for sensitive keys
 *   - Fire-and-forget DB write (rejection does not throw, does not suppress stdout)
 */

jest.mock('@/lib/db', () => ({
  prisma: {
    appLog: {
      create: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db'
import { logError, logAccess, log } from '@/lib/logger'

const mockCreate = prisma.appLog.create as jest.Mock

let stdoutSpy: jest.SpyInstance

beforeEach(() => {
  stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  mockCreate.mockResolvedValue({})
})

afterEach(() => {
  stdoutSpy.mockRestore()
  delete process.env.LOG_LEVEL
})

describe('message prefixes', () => {
  it('log() stdout message starts with [LOG]', () => {
    log({ message: 'test message' })
    expect(stdoutSpy).toHaveBeenCalledTimes(1)
    const written = stdoutSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(written)
    expect(parsed.message).toMatch(/^\[LOG\]/)
  })

  it('logError() stdout message starts with [ERROR]', () => {
    logError({ message: 'test error' })
    const written = stdoutSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(written)
    expect(parsed.message).toMatch(/^\[ERROR\]/)
  })

  it('logAccess() stdout message starts with [ACCESS]', () => {
    logAccess({ message: 'test access' })
    const written = stdoutSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(written)
    expect(parsed.message).toMatch(/^\[ACCESS\]/)
  })
})

describe('JSON output shape', () => {
  it('stdout output is valid JSON with timestamp, level, message, meta fields', () => {
    log({ message: 'shape test', meta: { key: 'value' } })
    const written = stdoutSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(written)
    expect(typeof parsed.timestamp).toBe('string')
    expect(parsed.level).toBe('LOG')
    expect(typeof parsed.message).toBe('string')
    expect(typeof parsed.meta).toBe('object')
  })
})

describe('LOG_LEVEL filtering', () => {
  it('LOG_LEVEL=ERROR suppresses log() — no stdout, no DB write', () => {
    process.env.LOG_LEVEL = 'ERROR'
    log({ message: 'should be suppressed' })
    expect(stdoutSpy).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('LOG_LEVEL=ERROR suppresses logAccess() — no stdout, no DB write', () => {
    process.env.LOG_LEVEL = 'ERROR'
    logAccess({ message: 'should be suppressed' })
    expect(stdoutSpy).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('LOG_LEVEL=ERROR still emits logError()', () => {
    process.env.LOG_LEVEL = 'ERROR'
    logError({ message: 'should emit' })
    expect(stdoutSpy).toHaveBeenCalledTimes(1)
  })

  it('LOG_LEVEL=ACCESS suppresses log() only', () => {
    process.env.LOG_LEVEL = 'ACCESS'
    log({ message: 'suppressed' })
    expect(stdoutSpy).not.toHaveBeenCalled()
    logAccess({ message: 'allowed' })
    logError({ message: 'allowed' })
    expect(stdoutSpy).toHaveBeenCalledTimes(2)
  })
})

describe('meta scrubbing', () => {
  it('meta key "password" value is replaced with [redacted]', () => {
    log({ message: 'test', meta: { password: 'secret123' } })
    const written = stdoutSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(written)
    expect(parsed.meta.password).toBe('[redacted]')
  })

  it('meta key "authToken" is scrubbed, normalKey is unchanged', () => {
    log({ message: 'test', meta: { authToken: 'abc', normalKey: 'visible' } })
    const written = stdoutSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(written)
    expect(parsed.meta.authToken).toBe('[redacted]')
    expect(parsed.meta.normalKey).toBe('visible')
  })
})

describe('DB write fire-and-forget', () => {
  it('DB write rejection does not throw', async () => {
    mockCreate.mockRejectedValueOnce(new Error('DB is down'))
    expect(() => logError({ message: 'test' })).not.toThrow()
    // Allow the microtask queue to drain so the rejection is handled
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('DB failure does not suppress stdout write', async () => {
    mockCreate.mockRejectedValueOnce(new Error('DB is down'))
    logError({ message: 'still logged to stdout' })
    expect(stdoutSpy).toHaveBeenCalledTimes(1)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
