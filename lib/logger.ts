import { prisma } from '@/lib/db'
import type { LogLevel, Prisma } from '@prisma/client'

export interface LogPayload {
  message: string
  userId?: string
  action?: string
  path?: string
  statusCode?: number
  meta?: Record<string, unknown>
}

const SENSITIVE_SUBSTRINGS = ['password', 'token', 'hash', 'secret', 'credential', 'auth']

function scrubMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta)) {
    const lower = k.toLowerCase()
    const sensitive = SENSITIVE_SUBSTRINGS.some((s) => lower.includes(s))
    result[k] = sensitive ? '[redacted]' : v
  }
  return result
}

function emit(level: LogLevel, payload: LogPayload): void {
  const logLevel = process.env.LOG_LEVEL ?? 'LOG'

  if (logLevel === 'ERROR' && level !== 'ERROR') return
  if (logLevel === 'ACCESS' && level === 'LOG') return

  const scrubbedMeta = payload.meta ? scrubMeta(payload.meta) : {}
  const message = `[${level}] ${payload.message}`

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    userId: payload.userId,
    action: payload.action,
    path: payload.path,
    statusCode: payload.statusCode,
    meta: scrubbedMeta,
  }

  process.stdout.write(JSON.stringify(entry) + '\n')

  prisma.appLog.create({
    data: {
      level,
      message,
      userId: payload.userId ?? null,
      action: payload.action ?? null,
      path: payload.path ?? null,
      statusCode: payload.statusCode ?? null,
      meta: scrubbedMeta as Prisma.InputJsonValue,
    },
  }).catch(() => { /* intentional: never propagate log failures */ })
}

export function logError(payload: LogPayload): void {
  emit('ERROR', payload)
}

export function logAccess(payload: LogPayload): void {
  emit('ACCESS', payload)
}

export function log(payload: LogPayload): void {
  emit('LOG', payload)
}
