import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { isAdmin } from '@/lib/permissions'
import { checkEmailSettingsRateLimit } from '@/lib/ratelimit'
import { encryptSmtpPassword } from '@/lib/encrypt'
import {
  validateSmtpHost,
  validateSmtpPort,
  validateFromAddress,
  validateFromName,
  validateSmtpUsername,
  validateSmtpPassword,
} from '@/lib/validation'
import type { Role } from '@prisma/client'

const SINGLETON_ID = 'global'

// GET /api/admin/email-settings — return current SMTP config (ADMIN only)
// Password is returned as "***" if set, "" if not set — never decrypted
export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin(session.user.role as Role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const setting = await prisma.emailSetting.findUnique({ where: { id: SINGLETON_ID } })

  if (!setting) {
    return NextResponse.json({
      enabled: false,
      host: '',
      port: 587,
      secure: false,
      username: '',
      passwordSet: false,
      fromAddress: '',
      fromName: '',
    })
  }

  return NextResponse.json({
    enabled: setting.enabled,
    host: setting.host,
    port: setting.port,
    secure: setting.secure,
    username: setting.username,
    passwordSet: setting.passwordEnc.length > 0,
    fromAddress: setting.fromAddress,
    fromName: setting.fromName,
  })
}

// PUT /api/admin/email-settings — upsert SMTP config (ADMIN only)
// Password is only updated when a non-empty string is supplied.
export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin(session.user.role as Role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await checkEmailSettingsRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const payload = body as Record<string, unknown>

  // enabled must be a boolean
  if (typeof payload.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
  }

  const errors: string[] = []

  const hostErr = validateSmtpHost(payload.host)
  if (hostErr) errors.push(hostErr)

  const portErr = validateSmtpPort(payload.port)
  if (portErr) errors.push(portErr)

  if (typeof payload.secure !== 'boolean') {
    errors.push('secure must be a boolean')
  }

  const usernameErr = validateSmtpUsername(payload.username)
  if (usernameErr) errors.push(usernameErr)

  const passwordErr = validateSmtpPassword(payload.password)
  if (passwordErr) errors.push(passwordErr)

  const fromAddressErr = validateFromAddress(payload.fromAddress)
  if (fromAddressErr) errors.push(fromAddressErr)

  const fromNameErr = validateFromName(payload.fromName)
  if (fromNameErr) errors.push(fromNameErr)

  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 400 })
  }

  // Encrypt password only if a new value was provided
  let passwordEnc: string | undefined
  if (typeof payload.password === 'string' && payload.password.length > 0) {
    try {
      passwordEnc = encryptSmtpPassword(payload.password)
    } catch {
      return NextResponse.json({ error: 'Failed to encrypt password — check EMAIL_ENCRYPTION_KEY env var' }, { status: 500 })
    }
  }

  // Fetch existing setting to preserve the stored password if no new one provided
  const existing = await prisma.emailSetting.findUnique({ where: { id: SINGLETON_ID } })

  const setting = await prisma.emailSetting.upsert({
    where: { id: SINGLETON_ID },
    update: {
      enabled: payload.enabled as boolean,
      host: (payload.host as string).trim(),
      port: payload.port as number,
      secure: payload.secure as boolean,
      username: typeof payload.username === 'string' ? payload.username.trim() : '',
      ...(passwordEnc !== undefined ? { passwordEnc } : {}),
      fromAddress: (payload.fromAddress as string).trim(),
      fromName: (payload.fromName as string).trim(),
    },
    create: {
      id: SINGLETON_ID,
      enabled: payload.enabled as boolean,
      host: (payload.host as string).trim(),
      port: payload.port as number,
      secure: payload.secure as boolean,
      username: typeof payload.username === 'string' ? payload.username.trim() : '',
      passwordEnc: passwordEnc ?? (existing?.passwordEnc ?? ''),
      fromAddress: (payload.fromAddress as string).trim(),
      fromName: (payload.fromName as string).trim(),
    },
  })

  return NextResponse.json({
    enabled: setting.enabled,
    host: setting.host,
    port: setting.port,
    secure: setting.secure,
    username: setting.username,
    passwordSet: setting.passwordEnc.length > 0,
    fromAddress: setting.fromAddress,
    fromName: setting.fromName,
  })
}
