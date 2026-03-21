import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { isAdmin } from '@/lib/permissions'
import { checkEmailSettingsRateLimit } from '@/lib/ratelimit'
import { verifyActiveSession } from '@/lib/session'
import { encryptSmtpPassword, encryptEntraClientSecret } from '@/lib/encrypt'
import { invalidateEntraTokenCache } from '@/lib/email'
import {
  validateEmailProvider,
  validateSmtpHost,
  validateSmtpPort,
  validateFromAddress,
  validateFromName,
  validateSmtpUsername,
  validateSmtpPassword,
  validateAzureGuid,
  validateEntraClientSecret,
} from '@/lib/validation'
import type { Role } from '@prisma/client'

const SINGLETON_ID = 'global'

// GET /api/admin/email-settings — return current config (ADMIN only)
// Secrets are returned as a boolean flag only — never decrypted
export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin(session.user.role as Role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!await verifyActiveSession(session.user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const setting = await prisma.emailSetting.findUnique({ where: { id: SINGLETON_ID } })

  if (!setting) {
    return NextResponse.json({
      enabled: false,
      provider: 'SMTP',
      host: '',
      port: 587,
      secure: false,
      username: '',
      passwordSet: false,
      entraTenantId: '',
      entraClientId: '',
      entraClientSecretSet: false,
      fromAddress: '',
      fromName: '',
    })
  }

  return NextResponse.json({
    enabled: setting.enabled,
    provider: setting.provider ?? 'SMTP',
    host: setting.host,
    port: setting.port,
    secure: setting.secure,
    username: setting.username,
    passwordSet: setting.passwordEnc.length > 0,
    entraTenantId: setting.entraTenantId ?? '',
    entraClientId: setting.entraClientId ?? '',
    entraClientSecretSet: (setting.entraClientSecretEnc?.length ?? 0) > 0,
    fromAddress: setting.fromAddress,
    fromName: setting.fromName,
  })
}

// PUT /api/admin/email-settings — upsert config (ADMIN only)
// Secrets are only updated when a non-empty string is supplied.
export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin(session.user.role as Role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!await verifyActiveSession(session.user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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

  // provider is required and must be valid
  const providerErr = validateEmailProvider(payload.provider)
  if (providerErr) {
    return NextResponse.json({ errors: [providerErr] }, { status: 400 })
  }

  const provider = payload.provider as 'SMTP' | 'ENTRA'
  const errors: string[] = []

  if (provider === 'SMTP') {
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
  } else {
    // ENTRA
    const tenantErr = validateAzureGuid(payload.entraTenantId, 'entraTenantId')
    if (tenantErr) errors.push(tenantErr)

    const clientErr = validateAzureGuid(payload.entraClientId, 'entraClientId')
    if (clientErr) errors.push(clientErr)

    const secretErr = validateEntraClientSecret(payload.entraClientSecret)
    if (secretErr) errors.push(secretErr)
  }

  const fromAddressErr = validateFromAddress(payload.fromAddress)
  if (fromAddressErr) errors.push(fromAddressErr)

  const fromNameErr = validateFromName(payload.fromName)
  if (fromNameErr) errors.push(fromNameErr)

  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 400 })
  }

  // Fetch existing record to preserve secrets when no new value provided
  const existing = await prisma.emailSetting.findUnique({ where: { id: SINGLETON_ID } })

  let setting: Awaited<ReturnType<typeof prisma.emailSetting.upsert>>

  if (provider === 'SMTP') {
    let passwordEnc: string | undefined
    if (typeof payload.password === 'string' && payload.password.length > 0) {
      try {
        passwordEnc = encryptSmtpPassword(payload.password)
      } catch {
        return NextResponse.json(
          { error: 'Failed to encrypt password — check EMAIL_ENCRYPTION_KEY env var' },
          { status: 500 },
        )
      }
    }

    setting = await prisma.emailSetting.upsert({
      where: { id: SINGLETON_ID },
      update: {
        enabled: payload.enabled,
        provider: 'SMTP',
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
        enabled: payload.enabled,
        provider: 'SMTP',
        host: (payload.host as string).trim(),
        port: payload.port as number,
        secure: payload.secure as boolean,
        username: typeof payload.username === 'string' ? payload.username.trim() : '',
        passwordEnc: passwordEnc ?? (existing?.passwordEnc ?? ''),
        fromAddress: (payload.fromAddress as string).trim(),
        fromName: (payload.fromName as string).trim(),
      },
    })
  } else {
    // ENTRA
    let entraClientSecretEnc: string | undefined
    if (typeof payload.entraClientSecret === 'string' && payload.entraClientSecret.length > 0) {
      try {
        entraClientSecretEnc = encryptEntraClientSecret(payload.entraClientSecret)
      } catch {
        return NextResponse.json(
          { error: 'Failed to encrypt client secret — check EMAIL_ENCRYPTION_KEY env var' },
          { status: 500 },
        )
      }
    }

    setting = await prisma.emailSetting.upsert({
      where: { id: SINGLETON_ID },
      update: {
        enabled: payload.enabled,
        provider: 'ENTRA',
        entraTenantId: (payload.entraTenantId as string).trim(),
        entraClientId: (payload.entraClientId as string).trim(),
        ...(entraClientSecretEnc !== undefined ? { entraClientSecretEnc } : {}),
        fromAddress: (payload.fromAddress as string).trim(),
        fromName: (payload.fromName as string).trim(),
      },
      create: {
        id: SINGLETON_ID,
        enabled: payload.enabled,
        provider: 'ENTRA',
        entraTenantId: (payload.entraTenantId as string).trim(),
        entraClientId: (payload.entraClientId as string).trim(),
        entraClientSecretEnc: entraClientSecretEnc ?? (existing?.entraClientSecretEnc ?? ''),
        fromAddress: (payload.fromAddress as string).trim(),
        fromName: (payload.fromName as string).trim(),
      },
    })
  }

  invalidateEntraTokenCache()

  return NextResponse.json({
    enabled: setting.enabled,
    provider: setting.provider,
    host: setting.host,
    port: setting.port,
    secure: setting.secure,
    username: setting.username,
    passwordSet: setting.passwordEnc.length > 0,
    entraTenantId: setting.entraTenantId,
    entraClientId: setting.entraClientId,
    entraClientSecretSet: setting.entraClientSecretEnc.length > 0,
    fromAddress: setting.fromAddress,
    fromName: setting.fromName,
  })
}
