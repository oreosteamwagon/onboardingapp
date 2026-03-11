import type { TaskType, ApprovalStatus } from '@prisma/client'

export const VALID_TASK_TYPES: readonly TaskType[] = ['STANDARD', 'UPLOAD'] as const
export const VALID_APPROVAL_ACTIONS: readonly ApprovalStatus[] = ['APPROVED', 'REJECTED'] as const

// CUID format: starts with 'c', followed by 24 alphanumeric chars (lowercase)
const CUID_RE = /^c[a-z0-9]{24}$/

export function validateCuid(v: unknown, fieldName = 'id'): string | null {
  if (typeof v !== 'string' || !CUID_RE.test(v)) {
    return `${fieldName} must be a valid identifier`
  }
  return null
}

export function validateTitle(v: unknown): string | null {
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > 256) {
    return 'title is required and must be 1-256 characters'
  }
  return null
}

export function validateDescription(v: unknown): string | null {
  if (v !== undefined && v !== null) {
    if (typeof v !== 'string' || v.length > 2000) {
      return 'description must be a string of at most 2000 characters'
    }
  }
  return null
}

export function validateTaskType(v: unknown): string | null {
  if (
    v !== undefined &&
    v !== null &&
    !(VALID_TASK_TYPES as readonly string[]).includes(v as string)
  ) {
    return `taskType must be one of: ${VALID_TASK_TYPES.join(', ')}`
  }
  return null
}

export function validateOrder(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.max(0, Math.floor(v))
  }
  return 0
}

export function validateWorkflowName(v: unknown): string | null {
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > 128) {
    return 'name is required and must be 1-128 characters'
  }
  return null
}

// Accepts only "APPROVED" or "REJECTED" — callers cannot pass "PENDING"
export function validateApprovalAction(v: unknown): string | null {
  if (!(VALID_APPROVAL_ACTIONS as readonly string[]).includes(v as string)) {
    return `action must be one of: ${VALID_APPROVAL_ACTIONS.join(', ')}`
  }
  return null
}
