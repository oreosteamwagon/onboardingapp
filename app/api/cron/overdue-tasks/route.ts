import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { processOverdueTasks } from '@/lib/email'
import { logError, log } from '@/lib/logger'
import { checkCronRateLimit } from '@/lib/ratelimit'
import { getClientIp } from '@/lib/ip'

// POST /api/cron/overdue-tasks
//
// Protected by a shared secret in the X-Cron-Secret header.
// Should be called by an external scheduler (Docker cron, Kubernetes CronJob,
// system cron, or a hosted cron service) once per day.
//
// Security assumptions:
//   - CRON_SECRET is a random string of at least 32 characters stored as an env var.
//   - This endpoint is NOT accessible without the correct secret.
//   - The endpoint is idempotent: re-running it will not send duplicate emails
//     because it only processes tasks where overdueNotifiedAt IS NULL.
export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers)
  try {
    await checkCronRateLimit(ip)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  const cronSecret = req.headers.get('x-cron-secret')

  if (!process.env.CRON_SECRET) {
    // Fail closed if CRON_SECRET is not configured
    logError({ message: 'CRON_SECRET env var is not set', action: 'cron_overdue' })
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

  try {
    const result = await processOverdueTasks()
    log({
      message: 'Overdue task notifications processed',
      action: 'cron_overdue',
      statusCode: 200,
      meta: { processed: result.processed, notified: result.notified },
    })
    return NextResponse.json(result)
  } catch (err: unknown) {
    logError({
      message: 'Overdue task cron failed',
      action: 'cron_overdue',
      meta: { error: String(err) },
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
