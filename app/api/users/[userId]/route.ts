import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canManageUsers } from '@/lib/permissions'
import type { Role } from '@prisma/client'

const VALID_ROLES: Role[] = ['USER', 'PAYROLL', 'HR', 'SUPERVISOR', 'ADMIN']

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

  const data: Record<string, unknown> = {}
  const payload = body as Record<string, unknown>

  if ('active' in payload) {
    if (typeof payload.active !== 'boolean') {
      return NextResponse.json({ error: 'active must be a boolean' }, { status: 400 })
    }
    data.active = payload.active
  }

  if ('role' in payload) {
    if (!VALID_ROLES.includes(payload.role as Role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }
    data.role = payload.role
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
      },
    })
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
    console.error('Update user error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
