import type { NextAuthConfig } from 'next-auth'
import type { Role } from '@prisma/client'

// Edge-compatible auth config (no native Node.js modules).
// Used by middleware; the full config (with argon2) lives in lib/auth.ts.

// Mirrors the Prisma Role enum. Kept here as a value (not a type import) so it
// can be used at runtime in the edge environment where @prisma/client cannot run.
// Must be updated if the schema enum changes.
const VALID_ROLES = new Set(['USER', 'SUPERVISOR', 'PAYROLL', 'HR', 'ADMIN'])
export const authConfig = {
  trustHost: true,
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours
  },
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === 'production'
          ? '__Secure-next-auth.session-token'
          : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'strict' as const,
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as { role: Role }).role
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string
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
