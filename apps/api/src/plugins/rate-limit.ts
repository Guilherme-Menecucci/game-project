import type { FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import type { Redis } from 'ioredis'

/**
 * Register @fastify/rate-limit global fallback with Redis store.
 *
 * Global fallback: 100 req/min per IP, namespace 'auth-rl:'.
 * Per-route overrides (per D-11) are declared in each individual route handler file:
 *   - login/register: 10 req/min per IP
 *   - guest token: 20 req/min per IP
 *   - password reset request: 5 req/15min per IP
 */
export async function registerRateLimit(app: FastifyInstance, redis: Redis): Promise<void> {
  await app.register(rateLimit, {
    redis,
    nameSpace: 'auth-rl:',
    max: 100,
    timeWindow: '1 minute',
  })
}
