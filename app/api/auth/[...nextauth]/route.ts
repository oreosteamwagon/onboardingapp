import { handlers } from '@/lib/auth'
import { checkLoginRateLimit } from '@/lib/ratelimit'
import { NextRequest, NextResponse } from 'next/server'

const { GET, POST: nextAuthPost } = handlers

async function POST(req: NextRequest) {
  const url = req.nextUrl.pathname

  if (url.includes('/callback/credentials')) {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.headers.get('x-real-ip') ??
      'unknown'

    try {
      await checkLoginRateLimit(ip)
    } catch {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again in 15 minutes.' },
        { status: 429 },
      )
    }
  }

  return nextAuthPost(req)
}

export { GET, POST }
