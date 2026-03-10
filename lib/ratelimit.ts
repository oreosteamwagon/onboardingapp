import { RateLimiterMemory } from 'rate-limiter-flexible'

// 10 attempts per IP per 15 minutes for login
const loginLimiter = new RateLimiterMemory({
  points: 10,
  duration: 15 * 60,
  blockDuration: 15 * 60,
})

export async function checkLoginRateLimit(ip: string): Promise<void> {
  await loginLimiter.consume(ip)
}
