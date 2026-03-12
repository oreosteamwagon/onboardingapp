'use client'

import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { useBranding } from '@/components/BrandingProvider'
import type { Role } from '@prisma/client'

interface NavBarProps {
  user: {
    id: string
    name?: string | null
    email?: string | null
    role: Role
  }
}

export default function NavBar({ user }: NavBarProps) {
  const { orgName } = useBranding()
  const isAdmin = user.role === 'ADMIN'
  const isHrOrAbove = ['HR', 'SUPERVISOR', 'ADMIN'].includes(user.role)
  const canApprove = ['PAYROLL', 'HR', 'SUPERVISOR', 'ADMIN'].includes(user.role)
  const canManageWorkflows = ['HR', 'ADMIN'].includes(user.role)
  // PAYROLL+ see "Team Tasks" (their team's progress) instead of their own checklist
  const showTeamTasks = canApprove

  return (
    <nav className="bg-primary text-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="font-semibold text-lg">
              {orgName}
            </Link>
            {showTeamTasks ? (
              <Link
                href="/team-tasks"
                className="text-sm hover:text-white/80 transition-colors"
              >
                Team Tasks
              </Link>
            ) : (
              <Link
                href={`/onboarding/${user.id}`}
                className="text-sm hover:text-white/80 transition-colors"
              >
                My Tasks
              </Link>
            )}
            <Link
              href="/documents"
              className="text-sm hover:text-white/80 transition-colors"
            >
              Documents
            </Link>
            {canApprove && (
              <Link
                href="/approvals"
                className="text-sm hover:text-white/80 transition-colors"
              >
                Approvals
              </Link>
            )}
            {isHrOrAbove && (
              <Link
                href="/admin/tasks"
                className="text-sm hover:text-white/80 transition-colors"
              >
                Tasks
              </Link>
            )}
            {canManageWorkflows && (
              <Link
                href="/admin/workflows"
                className="text-sm hover:text-white/80 transition-colors"
              >
                Workflows
              </Link>
            )}
            {isAdmin && (
              <>
                <Link
                  href="/admin/users"
                  className="text-sm hover:text-white/80 transition-colors"
                >
                  Users
                </Link>
                <Link
                  href="/admin/branding"
                  className="text-sm hover:text-white/80 transition-colors"
                >
                  Branding
                </Link>
              </>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-white/80">
              {user.name} ({user.role})
            </span>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="text-sm bg-white/20 hover:bg-white/30 rounded-md px-3 py-1 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}
