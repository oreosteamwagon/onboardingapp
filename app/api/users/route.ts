import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageUsers } from '@/lib/permissions'
import argon2 from 'argon2'
import { randomBytes } from 'crypto'
import type { Role } from '@prisma/client'

const VALID_ROLES: Role[] = ['USER', 'PAYROLL', 'HR', 'SUPERVISOR', 'ADMIN']

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!canManageUsers(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,
    },
  })

  return NextResponse.json(users)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!canManageUsers(session.user.role as Role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as Record<string, unknown>).username !== 'string' ||
    typeof (body as Record<string, unknown>).email !== 'string' ||
    typeof (body as Record<string, unknown>).role !== 'string'
  ) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const { username, email, role } = body as {
    username: string
    email: string
    role: string
  }

  if (username.length < 1 || username.length > 128) {
    return NextResponse.json({ error: 'Username must be 1-128 characters' }, { status: 400 })
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 256) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  if (!VALID_ROLES.includes(role as Role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  const tempPassword = randomBytes(12).toString('base64url')
  const passwordHash = await argon2.hash(tempPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  })

  try {
    const user = await prisma.user.create({
      data: {
        username: username.trim().toLowerCase(),
        email: email.trim().toLowerCase(),
        passwordHash,
        role: role as Role,
        active: true,
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ user, tempPassword }, { status: 201 })
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return NextResponse.json(
        { error: 'Username or email already exists' },
        { status: 409 },
      )
    }
    console.error('Create user error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
