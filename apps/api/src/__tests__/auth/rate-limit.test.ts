/**
 * Rate-limit integration tests for auth routes (SEC-04)
 *
 * Tests that /auth/login and /auth/register enforce max 10 requests/min per IP.
 * Uses remoteAddress (not x-forwarded-for) for IP — trustProxy not enabled.
 * Uses distinct IPs per test to prevent cross-test counter bleed.
 *
 * vi.mock('../../services/email.js') isolates Resend from these tests.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../server.js'
import { db } from '../../db/client.js'
import { accounts } from '../../db/schema.js'

// Isolate email service — rate-limit tests don't verify email sending
vi.mock('../../services/email.js', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}))

describe('Auth route rate limiting (SEC-04)', () => {
  let app: FastifyInstance

  // Use unique IPs per test run to avoid rate-limit bucket bleed
  const runId = process.pid % 65536
  const oct3 = Math.floor(runId / 256) % 256
  const oct4Base = runId % 256

  // Two distinct IPs — one per rate-limit test to prevent cross-test contamination
  const LOGIN_IP = `10.98.${oct3}.${oct4Base}`
  const REGISTER_IP = `10.99.${oct3}.${oct4Base}`

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    // Clean any accounts left from other test files
    await db.delete(accounts)
  })

  afterAll(async () => {
    await db.delete(accounts)
    await app.close()
  })

  it('11th POST /auth/login from same IP within 1 minute returns 429', async () => {
    let lastStatus = 0
    for (let i = 1; i <= 11; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: `ratelimit-login-${i}@example.com`, password: 'password123' },
        remoteAddress: LOGIN_IP,
      })
      lastStatus = res.statusCode
    }
    // The 11th request must be 429 (max is 10/min per D-11)
    expect(lastStatus).toBe(429)
  })

  it('11th POST /auth/register from same IP within 1 minute returns 429', async () => {
    let lastStatus = 0
    for (let i = 1; i <= 11; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: `ratelimit-register-${i}@example.com`,
          password: 'password123',
        },
        remoteAddress: REGISTER_IP,
      })
      lastStatus = res.statusCode
    }
    // The 11th request must be 429 (max is 10/min per D-11)
    expect(lastStatus).toBe(429)
  })
})
