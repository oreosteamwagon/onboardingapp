import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { redirect } from 'next/navigation'
import { canManageUsers } from '@/lib/permissions'
import type { Role } from '@prisma/client'
import UsersTable from './UsersTable'

export default async function UsersPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  if (!canManageUsers(session.user.role as Role)) {
    return (
      <div className="text-red-600 font-medium">
        Access denied. Admin role required.
      </div>
    )
  }

  const [users, supervisors] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
        firstName: true,
        lastName: true,
        preferredFirstName: true,
        preferredLastName: true,
        department: true,
        positionCode: true,
        supervisorId: true,
        supervisor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
          },
        },
      },
    }),
    prisma.user.findMany({
      where: {
        active: true,
        role: { in: ['SUPERVISOR', 'PAYROLL', 'HR', 'ADMIN'] },
      },
      orderBy: { lastName: 'asc' },
      select: { id: true, firstName: true, lastName: true, username: true },
    }),
  ])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">User Management</h1>
      </div>
      <UsersTable users={users} supervisors={supervisors} />
    </div>
  )
}
