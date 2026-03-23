import { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible'
import { redisClient } from '@/lib/redis'

interface LimiterOpts {
  keyPrefix: string
  points: number
  duration: number
  blockDuration?: number
}

function makeLimiter(opts: LimiterOpts): RateLimiterRedis | RateLimiterMemory {
  if (redisClient) return new RateLimiterRedis({ storeClient: redisClient, ...opts })
  return new RateLimiterMemory(opts)
}

// 10 attempts per IP per 15 minutes for login
const loginLimiter = makeLimiter({
  keyPrefix: 'rl:login',
  points: 10,
  duration: 15 * 60,
  blockDuration: 15 * 60,
})

// 30 task management operations per minute per authenticated user (HR+ only)
const taskMgmtLimiter = makeLimiter({
  keyPrefix: 'rl:task-mgmt',
  points: 30,
  duration: 60,
  blockDuration: 60,
})

// 10 file uploads per minute per authenticated user
const uploadLimiter = makeLimiter({
  keyPrefix: 'rl:upload',
  points: 10,
  duration: 60,
  blockDuration: 120,
})

// 30 workflow management operations per minute per user (HR+ only)
const workflowMgmtLimiter = makeLimiter({
  keyPrefix: 'rl:workflow-mgmt',
  points: 30,
  duration: 60,
  blockDuration: 60,
})

// 60 approval actions per minute per user (separate class from task management)
const approvalLimiter = makeLimiter({
  keyPrefix: 'rl:approval',
  points: 60,
  duration: 60,
  blockDuration: 60,
})

// 60 team-task reads per minute per authenticated user (SUPERVISOR+)
const teamTasksLimiter = makeLimiter({
  keyPrefix: 'rl:team-tasks',
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
const documentDownloadLimiter = makeLimiter({
  keyPrefix: 'rl:doc-download',
  points: 60,
  duration: 60,
  blockDuration: 60,
})

export async function checkDocumentDownloadRateLimit(userId: string): Promise<void> {
  await documentDownloadLimiter.consume(userId)
}

// 3 factory resets per hour per admin — extreme caution for a destructive operation
const factoryResetLimiter = makeLimiter({
  keyPrefix: 'rl:factory-reset',
  points: 3,
  duration: 60 * 60,
  blockDuration: 60 * 60,
})

export async function checkFactoryResetRateLimit(userId: string): Promise<void> {
  await factoryResetLimiter.consume(userId)
}

// 10 password resets per hour per admin — tighter limit for a high-privilege operation
const passwordResetLimiter = makeLimiter({
  keyPrefix: 'rl:pw-reset',
  points: 10,
  duration: 60 * 60,
  blockDuration: 60 * 60,
})

export async function checkPasswordResetRateLimit(userId: string): Promise<void> {
  await passwordResetLimiter.consume(userId)
}

// 10 document deletes per minute per ADMIN — tight limit for a destructive operation
const documentDeleteLimiter = makeLimiter({
  keyPrefix: 'rl:doc-delete',
  points: 10,
  duration: 60,
  blockDuration: 60,
})

export async function checkDocumentDeleteRateLimit(userId: string): Promise<void> {
  await documentDeleteLimiter.consume(userId)
}

// 10 attachment uploads per minute per authenticated HR+ user
const attachmentUploadLimiter = makeLimiter({ keyPrefix: 'rl:attach-upload', points: 10, duration: 60, blockDuration: 120 })
export async function checkAttachmentUploadRateLimit(userId: string): Promise<void> {
  await attachmentUploadLimiter.consume(userId)
}

// 60 attachment downloads per minute per authenticated user
const attachmentDownloadLimiter = makeLimiter({ keyPrefix: 'rl:attach-download', points: 60, duration: 60, blockDuration: 60 })
export async function checkAttachmentDownloadRateLimit(userId: string): Promise<void> {
  await attachmentDownloadLimiter.consume(userId)
}

// 20 profile updates per minute per admin
const userProfileUpdateLimiter = makeLimiter({
  keyPrefix: 'rl:profile-update',
  points: 20,
  duration: 60,
  blockDuration: 60,
})

export async function checkUserProfileUpdateRateLimit(userId: string): Promise<void> {
  await userProfileUpdateLimiter.consume(userId)
}

// 120 logo fetches per minute per IP — public endpoint, keyed by IP
const logoLimiter = makeLimiter({
  keyPrefix: 'rl:logo',
  points: 120,
  duration: 60,
  blockDuration: 60,
})

export async function checkLogoRateLimit(ip: string): Promise<void> {
  await logoLimiter.consume(ip)
}

// 20 category management operations per minute per ADMIN
const categoryMgmtLimiter = makeLimiter({ keyPrefix: 'rl:category-mgmt', points: 20, duration: 60, blockDuration: 60 })

export async function checkCategoryMgmtRateLimit(userId: string): Promise<void> {
  await categoryMgmtLimiter.consume(userId)
}

// 30 course authoring operations per minute per user (HR+ only)
const courseMgmtLimiter = makeLimiter({ keyPrefix: 'rl:course-mgmt', points: 30, duration: 60, blockDuration: 60 })
export async function checkCourseMgmtRateLimit(userId: string): Promise<void> {
  await courseMgmtLimiter.consume(userId)
}

// 20 quiz attempts per hour per user — prevents brute-forcing correct answers
const courseAttemptLimiter = makeLimiter({ keyPrefix: 'rl:course-attempt', points: 20, duration: 3600, blockDuration: 3600 })
export async function checkCourseAttemptRateLimit(userId: string): Promise<void> {
  await courseAttemptLimiter.consume(userId)
}

// 60 certificate views per minute per user
const certificateLimiter = makeLimiter({ keyPrefix: 'rl:certificate', points: 60, duration: 60, blockDuration: 60 })
export async function checkCertificateRateLimit(userId: string): Promise<void> {
  await certificateLimiter.consume(userId)
}

// 30 log reads per minute per ADMIN user
const logReadLimiter = makeLimiter({ keyPrefix: 'rl:log-read', points: 30, duration: 60, blockDuration: 60 })
export async function checkLogReadRateLimit(userId: string): Promise<void> {
  await logReadLimiter.consume(userId)
}

// 20 user creations per hour per admin
const userCreateLimiter = makeLimiter({ keyPrefix: 'rl:user-create', points: 20, duration: 3600, blockDuration: 3600 })
export async function checkUserCreateRateLimit(userId: string): Promise<void> {
  await userCreateLimiter.consume(userId)
}

// 10 email settings changes or test sends per minute per admin
const emailSettingsLimiter = makeLimiter({ keyPrefix: 'rl:email-settings', points: 10, duration: 60, blockDuration: 60 })
export async function checkEmailSettingsRateLimit(userId: string): Promise<void> {
  await emailSettingsLimiter.consume(userId)
}
