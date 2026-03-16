import { RateLimiterMemory } from 'rate-limiter-flexible'

// 10 attempts per IP per 15 minutes for login
const loginLimiter = new RateLimiterMemory({
  points: 10,
  duration: 15 * 60,
  blockDuration: 15 * 60,
})

// 30 task management operations per minute per authenticated user (HR+ only)
const taskMgmtLimiter = new RateLimiterMemory({
  points: 30,
  duration: 60,
  blockDuration: 60,
})

// 10 file uploads per minute per authenticated user
const uploadLimiter = new RateLimiterMemory({
  points: 10,
  duration: 60,
  blockDuration: 120,
})

// 30 workflow management operations per minute per user (HR+ only)
const workflowMgmtLimiter = new RateLimiterMemory({
  points: 30,
  duration: 60,
  blockDuration: 60,
})

// 60 approval actions per minute per user (separate class from task management)
const approvalLimiter = new RateLimiterMemory({
  points: 60,
  duration: 60,
  blockDuration: 60,
})

// 60 team-task reads per minute per authenticated user (SUPERVISOR+)
const teamTasksLimiter = new RateLimiterMemory({
  points: 60,
  duration: 60,
  blockDuration: 60,
})

export async function checkLoginRateLimit(ip: string): Promise<void> {
  await loginLimiter.consume(ip)
}

export async function checkTaskMgmtRateLimit(userId: string): Promise<void> {
  await taskMgmtLimiter.consume(userId)
}

export async function checkUploadRateLimit(userId: string): Promise<void> {
  await uploadLimiter.consume(userId)
}

export async function checkWorkflowMgmtRateLimit(userId: string): Promise<void> {
  await workflowMgmtLimiter.consume(userId)
}

export async function checkApprovalRateLimit(userId: string): Promise<void> {
  await approvalLimiter.consume(userId)
}

export async function checkTeamTasksRateLimit(userId: string): Promise<void> {
  await teamTasksLimiter.consume(userId)
}

// 60 document downloads per minute per authenticated user
const documentDownloadLimiter = new RateLimiterMemory({
  points: 60,
  duration: 60,
  blockDuration: 60,
})

export async function checkDocumentDownloadRateLimit(userId: string): Promise<void> {
  await documentDownloadLimiter.consume(userId)
}

// 3 factory resets per hour per admin — extreme caution for a destructive operation
const factoryResetLimiter = new RateLimiterMemory({
  points: 3,
  duration: 60 * 60,
  blockDuration: 60 * 60,
})

export async function checkFactoryResetRateLimit(userId: string): Promise<void> {
  await factoryResetLimiter.consume(userId)
}

// 10 password resets per hour per admin — tighter limit for a high-privilege operation
const passwordResetLimiter = new RateLimiterMemory({
  points: 10,
  duration: 60 * 60,
  blockDuration: 60 * 60,
})

export async function checkPasswordResetRateLimit(userId: string): Promise<void> {
  await passwordResetLimiter.consume(userId)
}

// 10 document deletes per minute per ADMIN — tight limit for a destructive operation
const documentDeleteLimiter = new RateLimiterMemory({
  points: 10,
  duration: 60,
  blockDuration: 60,
})

export async function checkDocumentDeleteRateLimit(userId: string): Promise<void> {
  await documentDeleteLimiter.consume(userId)
}

// 10 attachment uploads per minute per authenticated HR+ user
const attachmentUploadLimiter = new RateLimiterMemory({ points: 10, duration: 60, blockDuration: 120 })
export async function checkAttachmentUploadRateLimit(userId: string): Promise<void> {
  await attachmentUploadLimiter.consume(userId)
}

// 60 attachment downloads per minute per authenticated user
const attachmentDownloadLimiter = new RateLimiterMemory({ points: 60, duration: 60, blockDuration: 60 })
export async function checkAttachmentDownloadRateLimit(userId: string): Promise<void> {
  await attachmentDownloadLimiter.consume(userId)
}

// 20 profile updates per minute per admin
const userProfileUpdateLimiter = new RateLimiterMemory({
  points: 20,
  duration: 60,
  blockDuration: 60,
})

export async function checkUserProfileUpdateRateLimit(userId: string): Promise<void> {
  await userProfileUpdateLimiter.consume(userId)
}

// 120 logo fetches per minute per IP — public endpoint, keyed by IP
const logoLimiter = new RateLimiterMemory({
  points: 120,
  duration: 60,
  blockDuration: 60,
})

export async function checkLogoRateLimit(ip: string): Promise<void> {
  await logoLimiter.consume(ip)
}

// 20 category management operations per minute per ADMIN
const categoryMgmtLimiter = new RateLimiterMemory({ points: 20, duration: 60, blockDuration: 60 })

export async function checkCategoryMgmtRateLimit(userId: string): Promise<void> {
  await categoryMgmtLimiter.consume(userId)
}
