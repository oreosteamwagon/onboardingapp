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

// Letters (basic Latin + Latin Extended U+00C0-U+024F), spaces, hyphens, apostrophes, periods
// 1-100 chars, required (non-empty)
const NAME_RE = /^[a-zA-Z\u00C0-\u024F'\-. ]{1,100}$/

export function validateName(v: unknown, fieldName: string): string | null {
  if (typeof v !== 'string' || !NAME_RE.test(v)) {
    return `${fieldName} must be 1-100 characters and contain only letters, spaces, hyphens, apostrophes, or periods`
  }
  return null
}

// Letters, digits, spaces, hyphens, ampersands — e.g. "R&D", "IT Support", "Human Resources"
// 1-100 chars, required
const DEPT_RE = /^[a-zA-Z0-9\u00C0-\u024F &\-]{1,100}$/

export function validateDepartment(v: unknown): string | null {
  if (typeof v !== 'string' || !DEPT_RE.test(v)) {
    return 'department must be 1-100 characters and contain only letters, digits, spaces, hyphens, or ampersands'
  }
  return null
}

// Alphanumeric, hyphens, underscores — e.g. "ENG-001", "HR_MGR", "P001"
// 1-50 chars, required
const POS_RE = /^[a-zA-Z0-9\-_]{1,50}$/

export function validatePositionCode(v: unknown): string | null {
  if (typeof v !== 'string' || !POS_RE.test(v)) {
    return 'positionCode must be 1-50 characters and contain only letters, digits, hyphens, or underscores'
  }
  return null
}

// Letters (basic Latin + Latin Extended), digits, spaces, hyphens, ampersands
// 2-64 chars, required
const CATEGORY_NAME_RE = /^[a-zA-Z0-9\u00C0-\u024F &\-]{2,64}$/

export function validateCategoryName(v: unknown): string | null {
  if (typeof v !== 'string') return 'name must be a string'
  const trimmed = v.trim()
  if (!CATEGORY_NAME_RE.test(trimmed))
    return 'name must be 2-64 characters: letters, digits, spaces, hyphens, ampersands'
  return null
}

const WEB_LINK_URL_RE = /^https:\/\/.{1,2041}$/

export function validateWebLinkUrl(v: unknown): string | null {
  if (typeof v !== 'string') return 'url must be a string'
  const trimmed = v.trim()
  if (!WEB_LINK_URL_RE.test(trimmed)) return 'url must start with https:// and be at most 2048 characters'
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:') return 'url must use https'
  } catch {
    return 'url is not a valid URL'
  }
  return null
}

export function categoryNameToSlug(name: string): string {
  return name.trim().toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}
