import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/permissions'
import type { Role } from '@prisma/client'
import EmailSettingsForm from './EmailSettingsForm'

export default async function EmailSettingsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  if (!isAdmin(session.user.role as Role)) {
    return (
      <div className="text-red-600 font-medium">
        Access denied. Admin role required.
      </div>
    )
  }

  const setting = await prisma.emailSetting.findUnique({ where: { id: 'global' } })

  const initial = {
    enabled: setting?.enabled ?? false,
    provider: (setting?.provider ?? 'SMTP') as 'SMTP' | 'ENTRA',
    host: setting?.host ?? '',
    port: setting?.port ?? 587,
    secure: setting?.secure ?? false,
    username: setting?.username ?? '',
    passwordSet: (setting?.passwordEnc?.length ?? 0) > 0,
    entraTenantId: setting?.entraTenantId ?? '',
    entraClientId: setting?.entraClientId ?? '',
    entraClientSecretSet: (setting?.entraClientSecretEnc?.length ?? 0) > 0,
    fromAddress: setting?.fromAddress ?? '',
    fromName: setting?.fromName ?? '',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Email Settings</h2>
      </div>
      <EmailSettingsForm initial={initial} />
    </div>
  )
}
