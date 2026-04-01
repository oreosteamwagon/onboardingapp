import NextAuth from 'next-auth'
import { authConfig } from '@/auth.config'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const { auth } = NextAuth(authConfig)

const PUBLIC_PATHS = ['/login', '/api/auth', '/api/branding/logo', '/api/csp-report', '/api/health']

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src-elem 'self' 'nonce-${nonce}'`,
    // Inline style attributes (style="...") carry CSS only, not scripts.
    // Dynamic values like progress bar widths require unsafe-inline here.
    "style-src-attr 'unsafe-inline'",
    // Restrict to self, data URIs, and blobs only. External HTTPS images are
    // excluded to prevent tracking pixels and data exfiltration via injected
    // content. Course images should be embedded as data URIs or self-hosted.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "report-uri /api/csp-report",
    "report-to csp-endpoint",
  ].join('; ')
}

function applySecurityHeaders(response: NextResponse, csp: string): void {
  response.headers.set('Content-Security-Policy', csp)
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  response.headers.set('Reporting-Endpoints', 'csp-endpoint="/api/csp-report"')
}

export default auth(function middleware(req: NextRequest & { auth: unknown }) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = buildCsp(nonce)
  // Preserve request ID from the reverse proxy, or generate one for correlation
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID()
  const { pathname } = req.nextUrl
  const session = (req as { auth?: { user?: { role?: string; active?: boolean } } }).auth

  let response: NextResponse

  if (!PUBLIC_PATHS.some((p) => pathname.startsWith(p)) && !session?.user) {
    const loginUrl = new URL('/login', req.url)
    // Only pass relative, same-origin paths to prevent open redirect via the callbackUrl parameter.
    if (pathname.startsWith('/') && !pathname.startsWith('//')) {
      loginUrl.searchParams.set('callbackUrl', pathname)
    }
    response = NextResponse.redirect(loginUrl)
  } else if (!PUBLIC_PATHS.some((p) => pathname.startsWith(p)) && pathname === '/') {
    response = NextResponse.redirect(new URL('/dashboard', req.url))
  } else {
    // Forward nonce and request ID to server components via request headers
    const requestHeaders = new Headers(req.headers)
    requestHeaders.set('x-nonce', nonce)
    requestHeaders.set('x-request-id', requestId)
    response = NextResponse.next({ request: { headers: requestHeaders } })
  }

  applySecurityHeaders(response, csp)

  // Echo request ID for correlation across reverse proxy, Palo Alto, and app logs
  response.headers.set('X-Request-ID', requestId)

  // Prevent caching of authenticated API responses by reverse proxies and browsers.
  // The logo endpoint is excluded because it sets its own Cache-Control (public asset).
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/branding/logo')) {
    response.headers.set('Cache-Control', 'no-store')
  }

  return response
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
