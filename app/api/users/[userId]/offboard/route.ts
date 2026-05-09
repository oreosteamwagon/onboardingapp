import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { canManageUsers } from '@/lib/permissions'
import { verifyActiveSession } from '@/lib/session'
import { validateCuid } from '@/lib/validation'
import { isUserFullyApproved, offboardUser } from '@/lib/offboard'
import { checkOffboardRateLimit } from '@/lib/ratelimit'
import { prisma } from '@/lib/db'
import type { Role } from '@prisma/client'

interface RouteContext {
  params: { userId: string }
}

// POST /api/users/[userId]/offboard
// Manually triggers offboarding for a fully-approved USER account.
// Deletes the account, uploaded files, and sends completion notifications.
export async function POST(_req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!canManageUsers(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!await verifyActiveSession(session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await checkOffboardRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '3600' } })
  }

  const idError = validateCuid(params.userId, 'userId')
  if (idError) {
    return NextResponse.json({ error: idError }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, role: true },
  })

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  if (user.role !== 'USER') {
    return NextResponse.json(
      { error: 'Only USER accounts can be offboarded via this endpoint' },
      { status: 409 },
    )
  }

  const fullyApproved = await isUserFullyApproved(params.userId)
  if (!fullyApproved) {
    return NextResponse.json(
      { error: 'User has incomplete or unapproved tasks' },
      { status: 409 },
    )
  }

  await offboardUser(params.userId, session.user.id)

  return NextResponse.json({ success: true })
}
