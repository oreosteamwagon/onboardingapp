import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageUsers, roleRank } from '@/lib/permissions'
import { checkUserProfileUpdateRateLimit } from '@/lib/ratelimit'
import { logError, log } from '@/lib/logger'
import { verifyActiveSession } from '@/lib/session'
import { validateName, validateDepartment, validatePositionCode, validateCuid } from '@/lib/validation'
import type { Role } from '@prisma/client'

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
  supervisorId: true,
  supervisor: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true,
    },
  },
} as const

export async function PATCH(
  req: NextRequest,
  { params }: { params: { userId: string } },
) {
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

  const { userId } = params

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
  const errors: string[] = []
  const data: Record<string, unknown> = {}

  if ('active' in payload) {
    if (typeof payload.active !== 'boolean') {
      errors.push('active must be a boolean')
    } else {
      data.active = payload.active
    }
  }

  if ('role' in payload) {
    if (!VALID_ROLES.includes(payload.role as Role)) {
      errors.push('Invalid role')
    } else {
      data.role = payload.role
    }
  }

  // Profile fields
  if ('firstName' in payload) {
    const err = validateName(payload.firstName, 'firstName')
    if (err) errors.push(err)
    else data.firstName = payload.firstName
  }

  if ('lastName' in payload) {
    const err = validateName(payload.lastName, 'lastName')
    if (err) errors.push(err)
    else data.lastName = payload.lastName
  }

  if ('preferredFirstName' in payload) {
    if (payload.preferredFirstName === null) {
      data.preferredFirstName = null
    } else {
      const err = validateName(payload.preferredFirstName, 'preferredFirstName')
      if (err) errors.push(err)
      else data.preferredFirstName = payload.preferredFirstName
    }
  }

  if ('preferredLastName' in payload) {
    if (payload.preferredLastName === null) {
      data.preferredLastName = null
    } else {
      const err = validateName(payload.preferredLastName, 'preferredLastName')
      if (err) errors.push(err)
      else data.preferredLastName = payload.preferredLastName
    }
  }

  if ('department' in payload) {
    const err = validateDepartment(payload.department)
    if (err) errors.push(err)
    else data.department = payload.department
  }

  if ('positionCode' in payload) {
    const err = validatePositionCode(payload.positionCode)
    if (err) errors.push(err)
    else data.positionCode = payload.positionCode
  }

  let supervisorIdToSet: string | undefined = undefined
  if ('supervisorId' in payload) {
    if (payload.supervisorId === null) {
      errors.push('supervisorId is required')
    } else {
      const svErr = validateCuid(payload.supervisorId, 'supervisorId')
      if (svErr) {
        errors.push(svErr)
      } else {
        supervisorIdToSet = payload.supervisorId as string
      }
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 400 })
  }

  if (supervisorIdToSet !== undefined) {
    if (supervisorIdToSet === userId) {
      return NextResponse.json({ error: 'supervisorId cannot reference the user being updated' }, { status: 400 })
    }
    const sv = await prisma.user.findUnique({
      where: { id: supervisorIdToSet },
      select: { role: true, active: true },
    })
    if (!sv || !sv.active || roleRank(sv.role) < roleRank('SUPERVISOR')) {
      return NextResponse.json({ error: 'supervisorId must reference an active SUPERVISOR+ user' }, { status: 400 })
    }
    data.supervisorId = supervisorIdToSet
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  try {
    await checkUserProfileUpdateRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: USER_SELECT,
    })
    log({ message: 'user updated', action: 'user_update', userId: session.user.id, statusCode: 200, meta: { targetUserId: user.id, fields: Object.keys(data) } })
    return NextResponse.json(user)
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2025'
    ) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    logError({ message: 'Update user error', action: 'user_update', userId: session.user.id, meta: { error: String(err) } })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
