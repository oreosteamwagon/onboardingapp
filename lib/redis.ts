import IORedis from 'ioredis'

let client: IORedis | null = null

const redisUrl = process.env.REDIS_URL
if (redisUrl) {
  client = new IORedis(redisUrl, {
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
    tls: redisUrl.startsWith('rediss://') ? {} : undefined,
  })
  client.on('error', (err: Error) => {
    console.error('[redis] Connection error:', err.message)
  })
} else {
  console.warn(
    '[ratelimit] REDIS_URL not set — using in-memory rate limiters ' +
      '(not suitable for multi-instance deployments)',
  )
}

export const redisClient = client
