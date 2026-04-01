import { NextRequest, NextResponse } from 'next/server'
import { logError } from '@/lib/logger'
import { checkCspReportRateLimit } from '@/lib/ratelimit'
import { getClientIp } from '@/lib/ip'

// POST /api/csp-report
// Unauthenticated — browsers post CSP violation reports without credentials.
// Rate-limited by IP to prevent log flooding.
export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers)

  try {
    await checkCspReportRateLimit(ip)
  } catch {
    return new NextResponse(null, { status: 429, headers: { 'Retry-After': '60' } })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new NextResponse(null, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return new NextResponse(null, { status: 400 })
  }

  const report = (body as Record<string, unknown>)['csp-report']
  if (typeof report !== 'object' || report === null) {
    return new NextResponse(null, { status: 400 })
  }

  // Extract safe scalar fields only. Values are browser-generated but still
  // treated as untrusted: type-checked, cast to string, and truncated before
  // being written to the log to prevent oversized or injected entries.
  const v = report as Record<string, unknown>
  const blockedUri = typeof v['blocked-uri'] === 'string' ? v['blocked-uri'].slice(0, 500) : undefined
  const violatedDirective = typeof v['violated-directive'] === 'string' ? v['violated-directive'].slice(0, 200) : undefined
  const documentUri = typeof v['document-uri'] === 'string' ? v['document-uri'].slice(0, 500) : undefined

  logError({
    message: 'CSP violation',
    action: 'csp_violation',
    meta: { blockedUri, violatedDirective, documentUri },
  })

  return new NextResponse(null, { status: 204 })
}
