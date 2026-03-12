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

// Any authenticated user may upload a document to complete an UPLOAD-type onboarding task
// assigned via their workflow. Access is governed by workflow membership, NOT by
// canUploadDocuments (which gates general document uploads to HR+).
export function canCompleteUploadTask(_role: Role): boolean {
  return true
}

// Admin, Payroll, and HR can approve/confirm any task regardless of workflow context.
// This is a role-only check; supervisor scope is enforced at the route level via DB query.
export function canApproveAny(role: Role): boolean {
  return role === Role.ADMIN || role === Role.PAYROLL || role === Role.HR
}

// Supervisors can also approve, but only for tasks within their assigned workflow scope.
// Callers must enforce the scope check separately.
export function canApprove(role: Role): boolean {
  return canApproveAny(role) || role === Role.SUPERVISOR
}

export function canManageWorkflows(role: Role): boolean {
  return hasRole(role, Role.HR)
}

export function canAssignWorkflows(role: Role): boolean {
  return hasRole(role, Role.HR)
}

// PAYROLL, HR, and ADMIN can see all documents in the documents library.
// USER and SUPERVISOR see only documents they uploaded themselves.
export function canViewAllDocuments(role: Role): boolean {
  return canApproveAny(role)
}

// Any approver role (SUPERVISOR+) may download a document for review purposes.
// The caller must also check whether the requester is the uploader.
export function canDownloadDocument(role: Role): boolean {
  return canApprove(role)
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
