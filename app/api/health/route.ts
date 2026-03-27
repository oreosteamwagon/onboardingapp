import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// GET /api/health
// Unauthenticated endpoint for reverse proxy and firewall health probes.
// Returns 200 if the app and database are responsive, 503 otherwise.
// Does not write to AppLog to avoid flooding logs with probe entries.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok' }, { status: 200 })
  } catch {
    return NextResponse.json(
      { status: 'degraded', reason: 'database' },
      { status: 503 },
    )
  }
}
