import { Role } from '@prisma/client'

// Role hierarchy — higher index = more privilege
const ROLE_ORDER: Role[] = [
  Role.USER,
  Role.PAYROLL,
  Role.HR,
  Role.SUPERVISOR,
  Role.ADMIN,
]

export function roleRank(role: Role): number {
  return ROLE_ORDER.indexOf(role)
}

export function hasRole(userRole: Role, requiredRole: Role): boolean {
  return roleRank(userRole) >= roleRank(requiredRole)
}

export function isAdmin(role: Role): boolean {
  return role === Role.ADMIN
}

export function canManageUsers(role: Role): boolean {
  return role === Role.ADMIN
}

export function canUploadDocuments(role: Role): boolean {
  return hasRole(role, Role.HR)
}

export function canViewAllTasks(role: Role): boolean {
  return hasRole(role, Role.SUPERVISOR)
}

export function canManageTasks(role: Role): boolean {
  return hasRole(role, Role.HR)
}

export function canManageBranding(role: Role): boolean {
  return role === Role.ADMIN
}

// Returns allowed roles from a comma-separated header or session
export function assertRole(
  userRole: Role | undefined | null,
  requiredRole: Role,
): void {
  if (!userRole || !hasRole(userRole, requiredRole)) {
    throw new Error('Forbidden')
  }
}
