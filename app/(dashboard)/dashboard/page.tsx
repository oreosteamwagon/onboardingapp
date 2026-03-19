import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { canViewAllTasks, canApproveAny } from '@/lib/permissions'
import type { Role } from '@prisma/client'

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const user = session.user

  const [taskStats, documentCount] = await Promise.all([
    prisma.userTask.findMany({
      where: { userId: user.id },
      include: { task: true },
    }),
    prisma.document.count(),
  ])

  const completedCount = taskStats.filter((t) => t.completed).length
  const totalCount = taskStats.length

  const showUserTable = canViewAllTasks(user.role as Role)
  const isPayrollPlus = canApproveAny(user.role as Role)

  const pendingCount = isPayrollPlus
    ? await prisma.userTask.count({ where: { completed: true, approvalStatus: 'PENDING' } })
    : 0

  let pendingUsers: { id: string; username: string; completedCount: number; totalCount: number }[] = []

  if (showUserTable) {
    const allUserTasks = await prisma.userTask.findMany({
      include: { user: true },
    })
    const byUser = new Map<string, typeof allUserTasks>()
    for (const ut of allUserTasks) {
      const arr = byUser.get(ut.userId) ?? []
      arr.push(ut)
      byUser.set(ut.userId, arr)
    }
    pendingUsers = Array.from(byUser.entries()).map(([userId, tasks]) => ({
      id: userId,
      username: tasks[0].user.username,
      completedCount: tasks.filter((t) => t.completed).length,
      totalCount: tasks.length,
    }))
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard label="My Tasks Completed" value={`${completedCount} / ${totalCount}`} />
        <StatCard label="Total Documents" value={String(documentCount)} />
        <StatCard label="Role" value={user.role as string} />
      </div>

      <div className="flex gap-4 mb-8">
        {isPayrollPlus ? (
          <Link
            href="/approvals"
            className="rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Approvals{pendingCount > 0 && (
              <span className="ml-1.5 inline-flex items-center rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold">
                {pendingCount}
              </span>
            )}
          </Link>
        ) : (
          <>
            <Link
              href={`/onboarding/${user.id}`}
              className="rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
            >
              View My Checklist
            </Link>
            <Link
              href="/documents"
              className="rounded-md border border-gray-300 text-gray-700 px-4 py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Documents
            </Link>
          </>
        )}
      </div>

      {showUserTable && pendingUsers.length > 0 && (
        <div>
          <h2 className="text-lg font-medium text-gray-900 mb-3">
            Team Onboarding Progress
          </h2>
          <div className="overflow-x-auto bg-white rounded-lg shadow">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Progress
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {pendingUsers.map((u) => (
                  <tr key={u.id}>
                    <td className="px-6 py-4 text-sm text-gray-900">{u.username}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {u.completedCount} / {u.totalCount}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <Link
                        href={`/onboarding/${u.id}`}
                        className="text-primary hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg shadow px-6 py-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-semibold text-gray-900 mt-1">{value}</p>
    </div>
  )
}
