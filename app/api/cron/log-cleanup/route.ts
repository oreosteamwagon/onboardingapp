import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logError, log } from '@/lib/logger'
import { checkCronRateLimit } from '@/lib/ratelimit'
import { getClientIp } from '@/lib/ip'

// POST /api/cron/log-cleanup
//
// Deletes AppLog rows older than LOG_RETENTION_DAYS (default 90).
// Protected by the same CRON_SECRET mechanism as /api/cron/overdue-tasks.
// Should be scheduled to run periodically (e.g. nightly or weekly).
export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers)
  try {
    await checkCronRateLimit(ip)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  const cronSecret = req.headers.get('x-cron-secret')

  if (!process.env.CRON_SECRET) {
    logError({ message: 'CRON_SECRET env var is not set', action: 'cron_log_cleanup' })
    return NextResponse.json({ error: 'Cron not configured' }, { status: 503 })
  }

  if (!cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const expected = Buffer.from(process.env.CRON_SECRET, 'utf8')
  const received = Buffer.from(cronSecret, 'utf8')
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const configuredDays = parseInt(process.env.LOG_RETENTION_DAYS ?? '90', 10)
  const retentionDays = isNaN(configuredDays) || configuredDays < 1 ? 90 : configuredDays
  const threshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)

  try {
    const result = await prisma.appLog.deleteMany({
      where: { createdAt: { lt: threshold } },
    })
    log({
      message: 'AppLog retention cleanup completed',
      action: 'cron_log_cleanup',
      statusCode: 200,
      meta: { deleted: result.count, retentionDays },
    })
    return NextResponse.json({ deleted: result.count, retentionDays })
  } catch (err: unknown) {
    logError({
      message: 'AppLog retention cleanup failed',
      action: 'cron_log_cleanup',
      meta: { error: String(err) },
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
