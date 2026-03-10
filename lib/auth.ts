import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import argon2 from 'argon2'
import { prisma } from '@/lib/db'
import type { Role } from '@prisma/client'

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (
          typeof credentials?.username !== 'string' ||
          typeof credentials?.password !== 'string'
        ) {
          return null
        }

        const username = credentials.username.trim().toLowerCase()
        const password = credentials.password

        // Hard limit on input length to prevent DoS
        if (username.length > 128 || password.length > 256) {
          return null
        }

        const user = await prisma.user.findUnique({
          where: { username },
          select: {
            id: true,
            username: true,
            email: true,
            role: true,
            active: true,
            passwordHash: true,
          },
        })

        if (!user || !user.active) {
          // Constant-time dummy verify to prevent timing attacks
          await argon2.verify(
            '$argon2id$v=19$m=65536,t=3,p=4$dummy$dummy',
            password,
          ).catch(() => false)
          return null
        }

        let valid = false
        try {
          valid = await argon2.verify(user.passwordHash, password)
        } catch {
          return null
        }

        if (!valid) return null

        return {
          id: user.id,
          name: user.username,
          email: user.email,
          role: user.role,
        }
      },
    }),
  ],
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
        session.user.role = token.role as Role
      }
      return session
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
})

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      role: Role
    }
  }
}
