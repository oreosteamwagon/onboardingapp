import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { canManageTasks } from '@/lib/permissions'
import type { Role } from '@prisma/client'
import AdminNav from './AdminNav'

// Defense-in-depth: any route under /admin requires at least HR role.
// Individual pages enforce their own finer-grained checks on top of this.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  if (!canManageTasks(session.user.role as Role)) {
    redirect('/dashboard')
  }

  return (
    <div>
      <div className="mb-2">
        <h1 className="text-2xl font-semibold text-gray-900">Administration</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage tasks, workflows, users, and settings.
        </p>
      </div>
      <AdminNav role={session.user.role as Role} />
      {children}
    </div>
  )
}
