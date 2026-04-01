import type { NextAuthConfig } from 'next-auth'
import type { Role } from '@prisma/client'

// Edge-compatible auth config (no native Node.js modules).
// Used by middleware; the full config (with argon2) lives in lib/auth.ts.

// Mirrors the Prisma Role enum. Kept here as a value (not a type import) so it
// can be used at runtime in the edge environment where @prisma/client cannot run.
// Must be updated if the schema enum changes.
const VALID_ROLES = new Set(['USER', 'SUPERVISOR', 'PAYROLL', 'HR', 'ADMIN'])

// If no request is made within this window, the session expires on the next
// request and the user must re-authenticate. This limits the damage window
// when a session token is stolen but the legitimate user has stopped working.
const IDLE_TIMEOUT_SECONDS = 30 * 60 // 30 minutes

// True whenever the deployment is served over HTTPS, regardless of NODE_ENV.
// Guards against misconfigured staging environments that use HTTPS but forget
// to set NODE_ENV=production, which would otherwise strip the Secure flag and
// transmit session tokens in plaintext.
const isSecureContext =
  process.env.NODE_ENV === 'production' ||
  process.env.NEXTAUTH_URL?.startsWith('https:') === true

export const authConfig = {
  trustHost: true,
  session: {
    strategy: 'jwt',
    maxAge: 2 * 60 * 60, // 2 hours absolute maximum
  },
  cookies: {
    sessionToken: {
      // __Secure- prefix requires the Secure flag; use the same condition.
      name: isSecureContext
        ? '__Secure-next-auth.session-token'
        : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'strict' as const,
        path: '/',
        secure: isSecureContext,
      },
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      const now = Math.floor(Date.now() / 1000)

      if (user) {
        // Initial sign-in: populate custom claims
        token.id = user.id
        token.role = (user as { role: Role }).role
        token.lastActivity = now
        return token
      }

      // Subsequent requests: enforce idle timeout.
      // If lastActivity is missing (pre-existing token), treat as expired to
      // force re-authentication rather than silently granting an open session.
      const lastActivity = typeof token.lastActivity === 'number' ? token.lastActivity : 0
      if (now - lastActivity > IDLE_TIMEOUT_SECONDS) {
        // Return an empty object to invalidate the session. Auth.js treats a
        // token without the expected fields as unauthenticated.
        return { expired: true }
      }

      // Still active: refresh the timestamp
      token.lastActivity = now
      return token
    },
    async session({ session, token }) {
      if (token && typeof token.id === 'string') {
        session.user.id = token.id
        // Validate the role from the JWT before trusting it. An unrecognised
        // value (tampered token, stale data) leaves the role unset so that all
        // downstream permission checks fail closed.
        if (typeof token.role === 'string' && VALID_ROLES.has(token.role)) {
          session.user.role = token.role as Role
        }
      }
      return session
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [],
} satisfies NextAuthConfig
