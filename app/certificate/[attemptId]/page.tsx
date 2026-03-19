import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { redirect } from 'next/navigation'
import { canViewAnyCertificate } from '@/lib/permissions'
import { sanitizeHexColor } from '@/lib/validation'
import type { Role } from '@prisma/client'
import PrintButton from './PrintButton'

interface PageProps {
  params: { attemptId: string }
}

export default async function CertificatePage({ params }: PageProps) {
  const session = await auth()
  if (!session?.user) redirect('/login')

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

  if (!attempt) {
    return <div className="p-8 text-gray-600">Certificate not found.</div>
  }

  const isOwn = attempt.userId === session.user.id
  const canView = isOwn || canViewAnyCertificate(session.user.role as Role)

  if (!canView || !attempt.passed) {
    return <div className="p-8 text-gray-600">Access denied.</div>
  }

  const branding = await prisma.brandingSetting.findFirst({
    select: { orgName: true, logoPath: true, primaryColor: true },
  })

  const u = attempt.user
  const firstName = u.preferredFirstName ?? u.firstName ?? u.username
  const lastName = u.preferredLastName ?? u.lastName ?? ''
  const displayName = `${firstName} ${lastName}`.trim()
  const orgName = branding?.orgName ?? 'My Organization'
  const logoUrl = branding?.logoPath ? '/api/branding/logo' : null
  // Re-validate colors from DB before injecting into CSS (defense-in-depth)
  const primaryColor = sanitizeHexColor(branding?.primaryColor ?? '', '#2563eb')

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: letter landscape; margin: 0.75in; }
        }
      `}</style>

      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-8">
        <div className="no-print mb-6">
          <PrintButton />
        </div>

        <div
          className="bg-white w-full max-w-3xl rounded-lg shadow-lg px-16 py-12 text-center border-4"
          style={{ fontFamily: 'Georgia, serif', borderColor: primaryColor }}
        >
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={`${orgName} logo`}
              className="mx-auto mb-6 max-h-16 object-contain"
            />
          )}
          <p className="text-3xl font-bold text-gray-900 tracking-wide mb-2">{orgName}</p>
          <p className="text-xs uppercase tracking-widest text-gray-400 mb-8">presents this</p>

          <h1 className="text-4xl font-bold mb-8" style={{ color: primaryColor }}>Certificate of Completion</h1>

          <p className="text-base text-gray-600 mb-2">This certifies that</p>
          <p className="text-3xl font-semibold text-gray-900 mb-2">{displayName}</p>
          <p className="text-base text-gray-600 mb-2">has successfully completed</p>
          <p className="text-2xl font-semibold text-gray-800 mb-8">{attempt.course.title}</p>

          <div className="flex justify-center gap-12 text-sm text-gray-500">
            <div>
              <p className="font-medium text-gray-700">Score</p>
              <p>{attempt.score}%</p>
            </div>
            <div>
              <p className="font-medium text-gray-700">Completed</p>
              <p>
                {attempt.completedAt.toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
