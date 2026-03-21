import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { isAdmin } from '@/lib/permissions'
import { checkEmailSettingsRateLimit } from '@/lib/ratelimit'
import { sendTestEmail } from '@/lib/email'
import type { Role } from '@prisma/client'

// POST /api/admin/email-settings/test — send a test email to the admin's address (ADMIN only)
// Uses the currently saved SMTP settings. The request body is empty.
export async function POST(_req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin(session.user.role as Role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await checkEmailSettingsRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // Verify email is configured and enabled before attempting send
  const setting = await prisma.emailSetting.findUnique({ where: { id: 'global' } })
  if (!setting || !setting.enabled) {
    return NextResponse.json({ error: 'Email is not enabled. Save a valid configuration first.' }, { status: 409 })
  }

  const provider = setting.provider ?? 'SMTP'
  if (provider === 'ENTRA') {
    if (!setting.entraTenantId || !setting.entraClientId || !setting.entraClientSecretEnc || !setting.fromAddress) {
      return NextResponse.json({ error: 'Email configuration is incomplete.' }, { status: 409 })
    }
  } else {
    if (!setting.host || !setting.fromAddress) {
      return NextResponse.json({ error: 'Email configuration is incomplete.' }, { status: 409 })
    }
  }

  // Fetch the admin's own email address to send the test to
  const admin = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true },
  })
  if (!admin) return NextResponse.json({ error: 'Admin user not found' }, { status: 404 })

  try {
    await sendTestEmail(admin.email)
  } catch (err: unknown) {
    return NextResponse.json(
      { error: `Failed to send test email: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    )
  }

  return NextResponse.json({ sent: true, to: admin.email })
}
