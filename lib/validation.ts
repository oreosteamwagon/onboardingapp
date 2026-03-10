import type { Role, TaskType } from '@prisma/client'

export const VALID_ROLES: readonly Role[] = [
  'USER',
  'PAYROLL',
  'HR',
  'SUPERVISOR',
  'ADMIN',
] as const

export const VALID_TASK_TYPES: readonly TaskType[] = ['STANDARD', 'UPLOAD'] as const

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

export function validateAssignedRole(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) {
    return 'assignedRole must be a non-empty array'
  }
  for (const r of v) {
    if (!(VALID_ROLES as readonly string[]).includes(r)) {
      return `Invalid role: ${String(r).slice(0, 32)}`
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
