import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { canViewAnyCertificate } from '@/lib/permissions'
import { checkCertificateRateLimit } from '@/lib/ratelimit'
import { validateCuid, sanitizeHexColor } from '@/lib/validation'
import type { Role } from '@prisma/client'

interface RouteContext {
  params: { attemptId: string }
}

// GET /api/certificates/[attemptId] -- certificate data
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await checkCertificateRateLimit(session.user.id)
  } catch {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const cuidErr = validateCuid(params.attemptId, 'attemptId')
  if (cuidErr) return NextResponse.json({ error: cuidErr }, { status: 400 })

  const attempt = await prisma.courseAttempt.findUnique({
    where: { id: params.attemptId },
    select: {
      id: true,
      userId: true,
      score: true,
      passed: true,
      completedAt: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
          preferredFirstName: true,
          preferredLastName: true,
          username: true,
        },
      },
      course: { select: { title: true } },
    },
  })

  if (!attempt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Object-level auth: own attempt OR SUPERVISOR+
  if (
    attempt.userId !== session.user.id &&
    !canViewAnyCertificate(session.user.role as Role)
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // No certificate for failed attempts
  if (!attempt.passed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const branding = await prisma.brandingSetting.findFirst({
    select: { orgName: true, logoPath: true, primaryColor: true, accentColor: true },
  })

  const u = attempt.user
  const firstName = u.preferredFirstName ?? u.firstName ?? u.username
  const lastName = u.preferredLastName ?? u.lastName ?? ''
  const displayName = `${firstName} ${lastName}`.trim()

  return NextResponse.json({
    attemptId: attempt.id,
    displayName,
    courseName: attempt.course.title,
    completedAt: attempt.completedAt.toISOString(),
    score: attempt.score,
    orgName: branding?.orgName ?? 'My Organization',
    logoUrl: branding?.logoPath ? '/api/branding/logo' : null,
    primaryColor: sanitizeHexColor(branding?.primaryColor ?? '', '#2563eb'),
    accentColor: sanitizeHexColor(branding?.accentColor ?? '', '#7c3aed'),
  })
}
