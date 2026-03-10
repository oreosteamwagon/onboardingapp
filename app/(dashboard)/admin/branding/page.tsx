import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { redirect } from 'next/navigation'
import { canManageBranding } from '@/lib/permissions'
import type { Role } from '@prisma/client'
import BrandingForm from './BrandingForm'

export default async function BrandingPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  if (!canManageBranding(session.user.role as Role)) {
    return (
      <div className="text-red-600 font-medium">
        Access denied. Admin role required.
      </div>
    )
  }

  const branding = await prisma.brandingSetting.findFirst()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">
        Branding Settings
      </h1>
      <BrandingForm
        orgName={branding?.orgName ?? 'My Organization'}
        logoPath={branding?.logoPath ?? null}
        primaryColor={branding?.primaryColor ?? '#2563eb'}
        accentColor={branding?.accentColor ?? '#7c3aed'}
      />
    </div>
  )
}
