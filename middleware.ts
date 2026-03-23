import NextAuth from 'next-auth'
import { authConfig } from '@/auth.config'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const { auth } = NextAuth(authConfig)

const PUBLIC_PATHS = ['/login', '/api/auth', '/api/branding/logo']

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

function applySecurityHeaders(response: NextResponse, csp: string): void {
  response.headers.set('Content-Security-Policy', csp)
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
}

export default auth(function middleware(req: NextRequest & { auth: unknown }) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = buildCsp(nonce)
  const { pathname } = req.nextUrl
  const session = (req as { auth?: { user?: { role?: string; active?: boolean } } }).auth

  let response: NextResponse

  if (!PUBLIC_PATHS.some((p) => pathname.startsWith(p)) && !session?.user) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    response = NextResponse.redirect(loginUrl)
  } else if (!PUBLIC_PATHS.some((p) => pathname.startsWith(p)) && pathname === '/') {
    response = NextResponse.redirect(new URL('/dashboard', req.url))
  } else {
    // Forward nonce to server components via request header
    const requestHeaders = new Headers(req.headers)
    requestHeaders.set('x-nonce', nonce)
    response = NextResponse.next({ request: { headers: requestHeaders } })
  }

  applySecurityHeaders(response, csp)
  return response
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|uploads/).*)',
  ],
}
