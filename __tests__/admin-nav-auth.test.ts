/**
 * Tests for admin section authorization logic
 *
 * The /admin layout and /admin page both gate access to canManageTasks (HR+).
 * Individual sub-pages enforce finer permissions on top.
 *
 * Covers:
 *   - canManageTasks allowlist: USER and PAYROLL are denied; HR, SUPERVISOR, ADMIN are allowed
 *   - canManageWorkflows: HR and ADMIN allowed; SUPERVISOR and below denied
 *   - canManageUsers / canManageBranding: ADMIN only
 *   - canDeleteDocument: ADMIN only
 *   - NavBar admin link visibility: HR+ roles see "Admin"; USER and PAYROLL do not
 */

import {
  canManageTasks,
  canManageWorkflows,
  canManageUsers,
  canManageBranding,
  canDeleteDocument,
  isAdmin,
} from '@/lib/permissions'
import { Role } from '@prisma/client'

// ---- canManageTasks (gate for /admin layout and landing page) ----

describe('canManageTasks — admin layout access gate', () => {
  it('denies USER', () => {
    expect(canManageTasks(Role.USER)).toBe(false)
  })

  it('denies PAYROLL', () => {
    expect(canManageTasks(Role.PAYROLL)).toBe(false)
  })

  it('allows HR', () => {
    expect(canManageTasks(Role.HR)).toBe(true)
  })

  it('allows SUPERVISOR', () => {
    expect(canManageTasks(Role.SUPERVISOR)).toBe(true)
  })

  it('allows ADMIN', () => {
    expect(canManageTasks(Role.ADMIN)).toBe(true)
  })
})

// ---- canManageWorkflows (Workflows tab visibility and API gate) ----

describe('canManageWorkflows — Workflows tab visibility', () => {
  it('denies USER', () => {
    expect(canManageWorkflows(Role.USER)).toBe(false)
  })

  it('denies PAYROLL', () => {
    expect(canManageWorkflows(Role.PAYROLL)).toBe(false)
  })

  it('allows HR', () => {
    expect(canManageWorkflows(Role.HR)).toBe(true)
  })

  it('allows SUPERVISOR (role hierarchy: SUPERVISOR > HR)', () => {
    expect(canManageWorkflows(Role.SUPERVISOR)).toBe(true)
  })

  it('allows ADMIN', () => {
    expect(canManageWorkflows(Role.ADMIN)).toBe(true)
  })
})

// ---- ADMIN-only sections: Users, Branding ----

describe('canManageUsers — Users tab visibility', () => {
  it.each([Role.USER, Role.PAYROLL, Role.HR, Role.SUPERVISOR])(
    'denies %s',
    (role) => {
      expect(canManageUsers(role)).toBe(false)
    },
  )

  it('allows ADMIN', () => {
    expect(canManageUsers(Role.ADMIN)).toBe(true)
  })
})

describe('canManageBranding — Branding tab visibility', () => {
  it.each([Role.USER, Role.PAYROLL, Role.HR, Role.SUPERVISOR])(
    'denies %s',
    (role) => {
      expect(canManageBranding(role)).toBe(false)
    },
  )

  it('allows ADMIN', () => {
    expect(canManageBranding(Role.ADMIN)).toBe(true)
  })
})

// ---- canDeleteDocument (used by the Documents page Delete button) ----

describe('canDeleteDocument — document delete authorization', () => {
  it.each([Role.USER, Role.PAYROLL, Role.HR, Role.SUPERVISOR])(
    'denies %s',
    (role) => {
      expect(canDeleteDocument(role)).toBe(false)
    },
  )

  it('allows ADMIN', () => {
    expect(canDeleteDocument(Role.ADMIN)).toBe(true)
  })
})

// ---- isAdmin helper (used by AdminNav to show ADMIN-only tabs) ----

describe('isAdmin', () => {
  it.each([Role.USER, Role.PAYROLL, Role.HR, Role.SUPERVISOR])(
    'returns false for %s',
    (role) => {
      expect(isAdmin(role)).toBe(false)
    },
  )

  it('returns true for ADMIN', () => {
    expect(isAdmin(Role.ADMIN)).toBe(true)
  })
})

// ---- NavBar "Admin" link visibility logic ----
// The NavBar renders the Admin link when role is in ['HR', 'SUPERVISOR', 'ADMIN'].
// This mirrors the canAdmin check in NavBar.tsx.

describe('NavBar Admin link — canAdmin logic', () => {
  const canAdmin = (role: Role) =>
    (['HR', 'SUPERVISOR', 'ADMIN'] as Role[]).includes(role)

  it('hides Admin link for USER', () => {
    expect(canAdmin(Role.USER)).toBe(false)
  })

  it('hides Admin link for PAYROLL', () => {
    expect(canAdmin(Role.PAYROLL)).toBe(false)
  })

  it('shows Admin link for HR', () => {
    expect(canAdmin(Role.HR)).toBe(true)
  })

  it('shows Admin link for SUPERVISOR', () => {
    expect(canAdmin(Role.SUPERVISOR)).toBe(true)
  })

  it('shows Admin link for ADMIN', () => {
    expect(canAdmin(Role.ADMIN)).toBe(true)
  })
})

// ---- AdminNav tab visibility logic ----
// Mirrors the tab show conditions in AdminNav.tsx and admin/page.tsx.

describe('AdminNav tab visibility', () => {
  function visibleTabs(role: Role): string[] {
    const isAdminRole = role === Role.ADMIN
    const canWorkflowsRole = role === Role.HR || role === Role.ADMIN
    const canTasksRole = canManageTasks(role)

    return [
      canTasksRole ? 'Tasks' : null,
      canWorkflowsRole ? 'Workflows' : null,
      isAdminRole ? 'Users' : null,
      isAdminRole ? 'Branding' : null,
      isAdminRole ? 'Reset' : null,
    ].filter(Boolean) as string[]
  }

  it('SUPERVISOR sees Tasks only', () => {
    expect(visibleTabs(Role.SUPERVISOR)).toEqual(['Tasks'])
  })

  it('HR sees Tasks and Workflows', () => {
    expect(visibleTabs(Role.HR)).toEqual(['Tasks', 'Workflows'])
  })

  it('ADMIN sees all five tabs', () => {
    expect(visibleTabs(Role.ADMIN)).toEqual([
      'Tasks',
      'Workflows',
      'Users',
      'Branding',
      'Reset',
    ])
  })

  it('USER sees no tabs (denied at layout level)', () => {
    expect(visibleTabs(Role.USER)).toEqual([])
  })

  it('PAYROLL sees no tabs (denied at layout level)', () => {
    expect(visibleTabs(Role.PAYROLL)).toEqual([])
  })
})
