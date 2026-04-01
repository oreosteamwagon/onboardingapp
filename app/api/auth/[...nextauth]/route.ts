import { handlers } from '@/lib/auth'
import { checkLoginRateLimit } from '@/lib/ratelimit'
import { getClientIp } from '@/lib/ip'
import { NextRequest, NextResponse } from 'next/server'

const { GET, POST: nextAuthPost } = handlers

async function POST(req: NextRequest) {
  const url = req.nextUrl.pathname

  if (url.includes('/callback/credentials')) {
    const ip = getClientIp(req.headers)

    // When IP is unknown (no reverse proxy configured), key on the submitted
    // username instead of a shared 'unknown' bucket. Without this, any 10 failed
    // login attempts from any source would lock out all users for 15 minutes
    // (DoS via shared rate-limit bucket). Keying per-username limits the lockout
    // to the targeted account only.
    let rateLimitKey = ip
    if (ip === 'unknown') {
      try {
        const cloned = req.clone()
        const contentType = req.headers.get('content-type') ?? ''
        let submittedUsername = ''
        if (contentType.includes('application/json')) {
          const body = await cloned.json() as Record<string, unknown>
          submittedUsername = typeof body.username === 'string' ? body.username : ''
        } else {
          const text = await cloned.text()
          submittedUsername = new URLSearchParams(text).get('username') ?? ''
        }
        rateLimitKey = `unknown:${submittedUsername.toLowerCase().slice(0, 128)}`
      } catch {
        rateLimitKey = 'unknown'
      }
    }

    try {
      await checkLoginRateLimit(rateLimitKey)
    } catch {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again in 15 minutes.' },
        { status: 429, headers: { 'Retry-After': '900' } },
      )
    }
  }

  return nextAuthPost(req)
}

export { GET, POST }
