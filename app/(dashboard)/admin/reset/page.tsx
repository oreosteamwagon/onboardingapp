import { auth } from '@/lib/auth'
import { canManageUsers } from '@/lib/permissions'
import { redirect } from 'next/navigation'
import type { Role } from '@prisma/client'
import FactoryResetPanel from './FactoryResetPanel'

export default async function FactoryResetPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  if (!canManageUsers(session.user.role as Role)) {
    return (
      <div className="text-red-600 font-medium">
        Access denied. Admin role required.
      </div>
    )
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Factory Reset</h1>
      <p className="text-sm text-gray-500 mb-8">
        Testing utility — resets the app to the initial seeded state.
      </p>
      <FactoryResetPanel />
    </div>
  )
}
