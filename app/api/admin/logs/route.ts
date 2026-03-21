import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { isAdmin } from '@/lib/permissions'
import { checkLogReadRateLimit } from '@/lib/ratelimit'
import { verifyActiveSession } from '@/lib/session'
import {
  validateLogLevel,
  validateIsoDate,
  validatePageParam,
  validateLimitParam,
} from '@/lib/validation'
import { Prisma, LogLevel } from '@prisma/client'
import type { Role } from '@prisma/client'

const MAX_LIMIT = 50

// GET /api/admin/logs
// ADMIN only. Returns paginated, filtered application log entries.
// The route does not log itself to avoid recursive log entries.
export async function GET(req: NextRequest) {
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
    await checkLogReadRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { searchParams } = req.nextUrl
  const rawLevel = searchParams.get('level') ?? undefined
  const rawFrom = searchParams.get('from') ?? undefined
  const rawTo = searchParams.get('to') ?? undefined
  const rawPage = searchParams.get('page') ?? undefined
  const rawLimit = searchParams.get('limit') ?? undefined

  const levelError = validateLogLevel(rawLevel)
  if (levelError) return NextResponse.json({ error: levelError }, { status: 400 })

  const fromError = validateIsoDate(rawFrom, 'from')
  if (fromError) return NextResponse.json({ error: fromError }, { status: 400 })

  const toError = validateIsoDate(rawTo, 'to')
  if (toError) return NextResponse.json({ error: toError }, { status: 400 })

  const pageResult = validatePageParam(rawPage)
  if ('error' in pageResult) return NextResponse.json({ error: pageResult.error }, { status: 400 })

  const limitResult = validateLimitParam(rawLimit, MAX_LIMIT)
  if ('error' in limitResult) return NextResponse.json({ error: limitResult.error }, { status: 400 })

  const page = pageResult.value
  const limit = limitResult.value

  const where: Prisma.AppLogWhereInput = {}
  if (rawLevel) where.level = rawLevel as LogLevel
  if (rawFrom || rawTo) {
    where.createdAt = {}
    if (rawFrom) where.createdAt.gte = new Date(rawFrom)
    if (rawTo) where.createdAt.lte = new Date(rawTo)
  }

  const [logs, total] = await Promise.all([
    prisma.appLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.appLog.count({ where }),
  ])

  return NextResponse.json({
    logs: logs.map((l) => ({
      id: l.id,
      level: l.level,
      message: l.message,
      userId: l.userId,
      action: l.action,
      path: l.path,
      statusCode: l.statusCode,
      meta: l.meta,
      createdAt: l.createdAt.toISOString(),
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  })
}
