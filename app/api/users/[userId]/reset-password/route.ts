import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageUsers } from '@/lib/permissions'
import { checkPasswordResetRateLimit } from '@/lib/ratelimit'
import { verifyActiveSession } from '@/lib/session'
import { validateCuid } from '@/lib/validation'
import argon2 from 'argon2'
import { randomBytes } from 'crypto'
import type { Role } from '@prisma/client'

interface RouteContext {
  params: { userId: string }
}

// POST /api/users/[userId]/reset-password
// ADMIN only. Generates a cryptographically random temp password, hashes it with
// Argon2id, stores the hash, and returns the plaintext exactly once.
// The plaintext is never persisted or logged — the admin must relay it out-of-band.
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
    await checkPasswordResetRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const idError = validateCuid(params.userId, 'userId')
  if (idError) {
    return NextResponse.json({ error: idError }, { status: 400 })
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, active: true },
  })

  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  if (!targetUser.active) {
    return NextResponse.json(
      { error: 'Cannot reset password for an inactive user' },
      { status: 409 },
    )
  }

  // 128 bits of entropy — same scheme as user creation temp passwords
  const tempPassword = randomBytes(12).toString('base64url')

  const passwordHash = await argon2.hash(tempPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  })

  await prisma.user.update({
    where: { id: params.userId },
    data: { passwordHash },
  })

  // Return plaintext once — never logged, never stored.
  // Cache-Control: no-store prevents the credential from being retained in
  // proxy caches or browser DevTools network history.
  return NextResponse.json({ tempPassword }, {
    status: 200,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
