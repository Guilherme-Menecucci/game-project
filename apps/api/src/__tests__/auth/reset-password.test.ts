/**
 * Integration tests for POST /auth/reset-password/request and POST /auth/reset-password/confirm
 * (AUTH-07, SEC-04)
 *
 * Uses real Redis (ioredis singleton) to test rate limiting (D-11: 5/15min per IP)
 * and Redis token storage. Resend is mocked via vi.mock('resend') to intercept emails.
 *
 * Process.pid-based IPs prevent rate-limit counter bleed across test runs.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../server.js'
import { db } from '../../db/client.js'
import { accounts } from '../../db/schema.js'
import { redis } from '../../services/redis.js'

// Hoist the send mock so vi.mock factory can close over it
const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn().mockResolvedValue({ data: { id: 'test-email-id' }, error: null }),
}))

// Mock resend at the package level — lets the real services/email.ts run
// but intercepts the HTTP send. Using class syntax (not arrow function) for
// constructor compatibility per Pattern L (02-04 deviations).
vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = { send: sendMock }
  },
}))

describe('POST /auth/reset-password', () => {
  let app: FastifyInstance

  // Use unique IPs per test run to avoid rate-limit bucket bleed (process.pid pattern)
  const runId = process.pid % 65536
  const oct3 = Math.floor(runId / 256) % 256
  const oct4Base = runId % 256
  function testIp(offset: number): string {
    return `10.5.${oct3}.${(oct4Base + offset) % 256}`
  }
  // Use a dedicated IP for rate-limit testing
  const RATE_LIMIT_IP = `10.55.${oct3}.${oct4Base}`

  const TEST_EMAIL = 'reset-test@example.com'
  const TEST_PASSWORD = 'originalpassword123'
  const NEW_PASSWORD = 'newpassword456'

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    // Create a test account via register so we have a real account in DB
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
      remoteAddress: testIp(0),
    })
    vi.clearAllMocks()
  })

  afterEach(async () => {
    // Clean test state
    await db.delete(accounts)
    // Flush Redis to clear rate-limit counters and any test tokens
    await redis.flushdb()
    vi.clearAllMocks()
  })

  it('returns 200 for valid known email (T-02-19: no enumeration)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email: TEST_EMAIL },
      remoteAddress: testIp(1),
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      message: 'If an account exists for that address, a reset link is on its way.',
    })
  })

  it('returns 200 for unknown email with identical body (T-02-19: prevents user enumeration)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email: 'unknown@example.com' },
      remoteAddress: testIp(2),
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      message: 'If an account exists for that address, a reset link is on its way.',
    })
  })

  it('returns 400 for invalid email format', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email: 'not-an-email' },
      remoteAddress: testIp(3),
    })
    expect(response.statusCode).toBe(400)
  })

  it('stores a reset token in Redis with TTL ~900s after valid request (D-10)', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email: TEST_EMAIL },
      remoteAddress: testIp(4),
    })

    // Check that a reset: key was created in Redis
    const keys = await redis.keys('reset:*')
    expect(keys).toHaveLength(1)

    // TTL should be close to RESET_TOKEN_TTL = 900 seconds
    const ttl = await redis.ttl(keys[0])
    expect(ttl).toBeGreaterThan(890)
    expect(ttl).toBeLessThanOrEqual(900)
  })

  it('returns 200 and updates password on valid confirm (AUTH-07)', async () => {
    // Request reset to get token in Redis
    await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email: TEST_EMAIL },
      remoteAddress: testIp(5),
    })

    // Get the token from Redis
    const keys = await redis.keys('reset:*')
    const token = keys[0].replace('reset:', '')

    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/confirm',
      payload: { token, password: NEW_PASSWORD },
      remoteAddress: testIp(6),
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ message: 'Password updated successfully' })
  })

  it('returns 400 on second use of same token (T-02-21: single-use token)', async () => {
    // Request reset to get token
    await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email: TEST_EMAIL },
      remoteAddress: testIp(5),
    })

    const keys = await redis.keys('reset:*')
    const token = keys[0].replace('reset:', '')

    // First use — succeeds
    await app.inject({
      method: 'POST',
      url: '/auth/reset-password/confirm',
      payload: { token, password: NEW_PASSWORD },
      remoteAddress: testIp(6),
    })

    // Second use — same token must fail
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/confirm',
      payload: { token, password: 'anotherpassword789' },
      remoteAddress: testIp(7),
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_or_expired_token' })
  })

  it('returns 400 for a completely fake token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/reset-password/confirm',
      payload: { token: 'aaaa'.repeat(16), password: NEW_PASSWORD },
      remoteAddress: testIp(8),
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_or_expired_token' })
  })

  it('allows login with new password after successful confirm (AUTH-07 end-to-end)', async () => {
    // Request reset
    await app.inject({
      method: 'POST',
      url: '/auth/reset-password/request',
      payload: { email: TEST_EMAIL },
      remoteAddress: testIp(5),
    })

    const keys = await redis.keys('reset:*')
    const token = keys[0].replace('reset:', '')

    // Apply reset
    await app.inject({
      method: 'POST',
      url: '/auth/reset-password/confirm',
      payload: { token, password: NEW_PASSWORD },
      remoteAddress: testIp(6),
    })

    // Login with new password — should succeed
    const loginNew = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: TEST_EMAIL, password: NEW_PASSWORD },
      remoteAddress: testIp(9),
    })
    expect(loginNew.statusCode).toBe(200)

    // Login with old password — should fail
    const loginOld = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
      remoteAddress: testIp(10),
    })
    expect(loginOld.statusCode).toBe(401)
  })

  it('returns 429 on 6th request within 15 minutes from same IP (D-11, SEC-04)', async () => {
    let lastStatus = 0
    for (let i = 1; i <= 6; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/reset-password/request',
        payload: { email: `ratelimit-reset${i}@example.com` },
        remoteAddress: RATE_LIMIT_IP,
      })
      lastStatus = res.statusCode
    }
    expect(lastStatus).toBe(429)
  })
})
