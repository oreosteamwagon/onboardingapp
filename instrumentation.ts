export async function register() {
  if (process.env.NODE_ENV === 'production' && !process.env.TRUST_PROXY) {
    console.warn(
      '[security] TRUST_PROXY is not set in production. Login rate limiting falls back to ' +
        'per-username keying when the client IP cannot be determined. ' +
        'Set TRUST_PROXY=true only when a trusted reverse proxy is confirmed to be stripping ' +
        'or overwriting X-Forwarded-For before forwarding. See lib/ip.ts for details.',
    )
  }
}
