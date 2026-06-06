import Redis from 'ioredis'
import { env } from '../env.js'

/**
 * ioredis singleton — used by @fastify/rate-limit store and password reset token store.
 * connectTimeout and maxRetriesPerRequest match @fastify/rate-limit recommended config.
 */
export const redis = new Redis(env.REDIS_URL, {
  connectTimeout: 500,
  maxRetriesPerRequest: 1,
})
