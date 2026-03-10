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

export async function checkLoginRateLimit(ip: string): Promise<void> {
  await loginLimiter.consume(ip)
}

export async function checkTaskMgmtRateLimit(userId: string): Promise<void> {
  await taskMgmtLimiter.consume(userId)
}

export async function checkUploadRateLimit(userId: string): Promise<void> {
  await uploadLimiter.consume(userId)
}
