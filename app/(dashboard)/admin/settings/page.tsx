import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/permissions'
import { prisma } from '@/lib/db'
import type { Role } from '@prisma/client'
import AppSettingsForm from './AppSettingsForm'

export default async function SettingsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (!isAdmin(session.user.role as Role)) redirect('/admin')

  const setting = await prisma.appSetting.findFirst()
  const autoOffboardEnabled = setting?.autoOffboardEnabled ?? false

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Settings</h1>
      <AppSettingsForm initialAutoOffboard={autoOffboardEnabled} />
    </div>
  )
}
