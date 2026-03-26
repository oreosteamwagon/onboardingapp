import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import argon2 from 'argon2'
import { prisma } from '@/lib/db'
import { authConfig } from '@/auth.config'
import { logAccess } from '@/lib/logger'
import type { Role } from '@prisma/client'

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
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
          logAccess({ message: 'login failed', action: 'login_failure', path: '/api/auth/callback/credentials' })
          return null
        }

        let valid = false
        try {
          valid = await argon2.verify(user.passwordHash, password)
        } catch {
          return null
        }

        if (!valid) {
          logAccess({ message: 'login failed', action: 'login_failure', path: '/api/auth/callback/credentials' })
          return null
        }

        logAccess({ message: 'login successful', action: 'login_success', userId: user.id, path: '/api/auth/callback/credentials', meta: { role: user.role } })

        return {
          id: user.id,
          name: user.username,
          email: user.email,
          role: user.role,
        }
      },
    }),
  ],
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
