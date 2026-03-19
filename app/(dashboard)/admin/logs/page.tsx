import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/permissions'
import type { Role } from '@prisma/client'
import LogViewer from './LogViewer'

export default async function LogsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  if (!isAdmin(session.user.role as Role)) {
    return <div className="text-red-600 font-medium">Access denied. Admin role required.</div>
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">System Logs</h1>
      <p className="text-sm text-gray-500 mb-6">Structured logs for security auditing and diagnostics.</p>
      <LogViewer />
    </div>
  )
}
