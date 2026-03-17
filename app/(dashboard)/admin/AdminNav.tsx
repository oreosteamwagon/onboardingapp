'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Role } from '@prisma/client'

interface AdminNavProps {
  role: Role
}

interface Tab {
  href: string
  label: string
  show: boolean
  danger?: boolean
}

export default function AdminNav({ role }: AdminNavProps) {
  const pathname = usePathname()
  const isAdmin = role === 'ADMIN'
  const canWorkflows = role === 'HR' || role === 'ADMIN'

  const tabs: Tab[] = [
    { href: '/admin/tasks',               label: 'Tasks',      show: true },
    { href: '/admin/workflows',           label: 'Workflows',  show: canWorkflows },
    { href: '/admin/learning',            label: 'Learning',   show: canWorkflows },
    { href: '/admin/users',               label: 'Users',      show: isAdmin },
    { href: '/admin/branding',            label: 'Branding',   show: isAdmin },
    { href: '/admin/document-categories', label: 'Categories', show: isAdmin },
    { href: '/admin/reset',               label: 'Reset',      show: isAdmin, danger: true },
  ]

  return (
    <div className="mb-6 border-b border-gray-200">
      <nav className="-mb-px flex gap-1" aria-label="Admin sections">
        {tabs
          .filter((t) => t.show)
          .map((tab) => {
            const active = pathname === tab.href
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={[
                  'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                  active
                    ? tab.danger
                      ? 'border-red-500 text-red-600'
                      : 'border-primary text-primary'
                    : tab.danger
                      ? 'border-transparent text-red-500 hover:text-red-700 hover:border-red-300'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                ].join(' ')}
              >
                {tab.label}
              </Link>
            )
          })}
      </nav>
    </div>
  )
}
