/**
 * Extracts the client IP address for rate-limiting purposes.
 *
 * X-Forwarded-For is only trusted when TRUST_PROXY is set, because the header
 * can be spoofed by any client that reaches the app directly. When the app runs
 * behind a trusted reverse proxy (Nginx, Caddy, etc.), the proxy must strip or
 * override the header before forwarding so that only the real client IP appears.
 *
 * When TRUST_PROXY is not set (e.g. local development without a proxy), the
 * function returns 'unknown'. All unknown-IP requests share one rate-limit
 * bucket, which is fail-closed: the limit is still enforced, just less
 * granularly.
 *
 * Security requirement: set TRUST_PROXY=true only when a trusted reverse proxy
 * is confirmed to be stripping client-supplied X-Forwarded-For headers.
 */
export function getClientIp(headers: Headers): string {
  if (process.env.TRUST_PROXY) {
    const xff = headers.get('x-forwarded-for')
    if (xff) {
      const first = xff.split(',')[0].trim()
      if (first) return first
    }
    const realIp = headers.get('x-real-ip')
    if (realIp) return realIp.trim()
  }
  return 'unknown'
}
