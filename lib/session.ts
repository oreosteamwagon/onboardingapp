import { prisma } from '@/lib/db'

/**
 * Verifies that the session user still exists in the database and is active.
 *
 * Call this after auth() and the role check on every authenticated API route to
 * compensate for the JWT trust gap: an 8-hour maxAge means a deactivated user
 * retains a valid session until expiry. This check denies them immediately.
 *
 * Returns true if the user exists and is active, false otherwise.
 * Callers should return 403 Forbidden on false.
 */
export async function verifyActiveSession(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { active: true },
  })
  return user?.active === true
}
