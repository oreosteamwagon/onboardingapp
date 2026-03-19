import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { canManageTasks } from '@/lib/permissions'
import type { Role } from '@prisma/client'
import Link from 'next/link'

interface Section {
  href: string
  label: string
  description: string
  show: boolean
  danger?: boolean
}

export default async function AdminPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const role = session.user.role as Role
  if (!canManageTasks(role)) redirect('/dashboard')

  const isAdmin = role === 'ADMIN'
  const canWorkflows = role === 'HR' || role === 'ADMIN'

  const sections: Section[] = [
    {
      href: '/admin/tasks',
      label: 'Tasks',
      description: 'Define and manage onboarding task definitions used across workflows.',
      show: true,
    },
    {
      href: '/admin/workflows',
      label: 'Workflows',
      description: 'Create workflows, add tasks to them, and assign them to users.',
      show: canWorkflows,
    },
    {
      href: '/admin/learning',
      label: 'Learning',
      description: 'Create and manage courses with quiz questions for learning tasks.',
      show: canWorkflows,
    },
    {
      href: '/admin/users',
      label: 'Users',
      description: 'Manage user accounts, roles, and active status.',
      show: isAdmin,
    },
    {
      href: '/admin/branding',
      label: 'Branding',
      description: 'Customize the organization name, primary color, and logo.',
      show: isAdmin,
    },
    {
      href: '/admin/document-categories',
      label: 'Categories',
      description: 'Manage document categories available when uploading documents.',
      show: isAdmin,
    },
    {
      href: '/admin/logs',
      label: 'Logs',
      description: 'View structured application logs for security auditing and diagnostics.',
      show: isAdmin,
    },
    {
      href: '/admin/reset',
      label: 'Reset',
      description: 'Factory reset — restores the application to its initial seeded state.',
      show: isAdmin,
      danger: true,
    },
  ]

  const visible = sections.filter((s) => s.show)

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {visible.map((section) => (
        <Link
          key={section.href}
          href={section.href}
          className={[
            'block rounded-lg border bg-white p-6 shadow-sm transition-shadow hover:shadow-md',
            section.danger ? 'border-red-200 hover:border-red-300' : 'border-gray-200 hover:border-gray-300',
          ].join(' ')}
        >
          <h2
            className={[
              'text-base font-semibold mb-1',
              section.danger ? 'text-red-600' : 'text-gray-900',
            ].join(' ')}
          >
            {section.label}
          </h2>
          <p className="text-sm text-gray-500">{section.description}</p>
        </Link>
      ))}
    </div>
  )
}
