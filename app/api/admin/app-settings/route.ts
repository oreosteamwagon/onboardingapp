import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { isAdmin } from '@/lib/permissions'
import { verifyActiveSession } from '@/lib/session'
import { checkAppSettingsRateLimit } from '@/lib/ratelimit'
import { prisma } from '@/lib/db'
import type { Role } from '@prisma/client'

async function getOrCreateSetting() {
  const existing = await prisma.appSetting.findFirst()
  if (existing) return existing
  return prisma.appSetting.create({ data: { id: 'global' } })
}

export async function GET(_req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isAdmin(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!await verifyActiveSession(session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const setting = await getOrCreateSetting()
  return NextResponse.json({ autoOffboardEnabled: setting.autoOffboardEnabled })
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isAdmin(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!await verifyActiveSession(session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await checkAppSettingsRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
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

  const { autoOffboardEnabled } = body as Record<string, unknown>

  if (typeof autoOffboardEnabled !== 'boolean') {
    return NextResponse.json({ error: 'autoOffboardEnabled must be a boolean' }, { status: 400 })
  }

  const setting = await prisma.appSetting.upsert({
    where: { id: 'global' },
    create: { id: 'global', autoOffboardEnabled },
    update: { autoOffboardEnabled },
  })

  return NextResponse.json({ autoOffboardEnabled: setting.autoOffboardEnabled })
}
