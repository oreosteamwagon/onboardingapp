import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageUsers } from '@/lib/permissions'
import { logError, log } from '@/lib/logger'
import argon2 from 'argon2'
import { randomBytes } from 'crypto'
import type { Role } from '@prisma/client'
import { validateName, validateDepartment, validatePositionCode } from '@/lib/validation'

const VALID_ROLES: Role[] = ['USER', 'PAYROLL', 'HR', 'SUPERVISOR', 'ADMIN']

const USER_SELECT = {
  id: true,
  username: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
  firstName: true,
  lastName: true,
  preferredFirstName: true,
  preferredLastName: true,
  department: true,
  positionCode: true,
} as const

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
    select: USER_SELECT,
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

  const payload = body as Record<string, unknown>
  const { username, email, role } = payload as {
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

  const errors: string[] = []

  const firstNameErr = validateName(payload.firstName, 'firstName')
  if (firstNameErr) errors.push(firstNameErr)

  const lastNameErr = validateName(payload.lastName, 'lastName')
  if (lastNameErr) errors.push(lastNameErr)

  if (payload.preferredFirstName !== undefined && payload.preferredFirstName !== null) {
    const err = validateName(payload.preferredFirstName, 'preferredFirstName')
    if (err) errors.push(err)
  }

  if (payload.preferredLastName !== undefined && payload.preferredLastName !== null) {
    const err = validateName(payload.preferredLastName, 'preferredLastName')
    if (err) errors.push(err)
  }

  const departmentErr = validateDepartment(payload.department)
  if (departmentErr) errors.push(departmentErr)

  const positionCodeErr = validatePositionCode(payload.positionCode)
  if (positionCodeErr) errors.push(positionCodeErr)

  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 400 })
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
        firstName: payload.firstName as string,
        lastName: payload.lastName as string,
        preferredFirstName: (payload.preferredFirstName as string | null | undefined) ?? null,
        preferredLastName: (payload.preferredLastName as string | null | undefined) ?? null,
        department: payload.department as string,
        positionCode: payload.positionCode as string,
      },
      select: USER_SELECT,
    })

    log({ message: 'user created', action: 'user_create', userId: session.user.id, statusCode: 201, meta: { newUserId: user.id, role: user.role } })
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
    logError({ message: 'Create user error', action: 'user_create', userId: session.user.id, meta: { error: String(err) } })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
