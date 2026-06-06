/**
 * Integration tests for POST /auth/login (AUTH-03)
 *
 * vi.mock('../../services/email.js') isolates Resend from these tests.
 * The register setup call would otherwise hit the real send path in test mode.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../server.js'
import { db } from '../../db/client.js'
import { accounts } from '../../db/schema.js'

// Isolate email service — login tests don't need to verify the email send path
vi.mock('../../services/email.js', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}))

describe('POST /auth/login', () => {
  let app: FastifyInstance

  // Use unique IPs per test run to avoid rate-limit bucket bleed
  const runId = process.pid % 65536
  const oct3 = Math.floor(runId / 256) % 256
  const oct4Base = runId % 256
  function testIp(offset: number): string {
    return `10.3.${oct3}.${(oct4Base + offset) % 256}`
  }

  const TEST_EMAIL = 'login-test@example.com'
  const TEST_PASSWORD = 'correctpassword123'

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    // Create test account
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
      remoteAddress: testIp(0),
    })
  })

  afterEach(async () => {
    // Clean test state
    await db.delete(accounts)
    vi.clearAllMocks()
  })

  it('returns 200 for valid credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
      remoteAddress: testIp(1),
    })
    expect(response.statusCode).toBe(200)
  })

  it('returns 30-day persistent cookie on successful login (D-02)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
      remoteAddress: testIp(2),
    })
    expect(response.statusCode).toBe(200)
    const setCookie = response.headers['set-cookie'] as string
    expect(setCookie).toMatch(/session=/)
    expect(setCookie).toMatch(/Max-Age=2592000/i)
    expect(setCookie).toMatch(/HttpOnly/i)
  })

  it('returns body { userId, isGuest: false, displayName }', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
      remoteAddress: testIp(3),
    })
    expect(response.statusCode).toBe(200)
    const body = response.json<{ userId: string; isGuest: boolean; displayName: string }>()
    expect(body.isGuest).toBe(false)
    expect(typeof body.userId).toBe('string')
    expect(typeof body.displayName).toBe('string')
  })

  it('returns 401 for wrong password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: TEST_EMAIL, password: 'wrongpassword' },
      remoteAddress: testIp(4),
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: 'invalid_credentials' })
  })

  it('returns 401 for unknown email', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'unknown@example.com', password: TEST_PASSWORD },
      remoteAddress: testIp(5),
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: 'invalid_credentials' })
  })

  it('wrong password and unknown email return identical response body (T-02-17 user enumeration prevention)', async () => {
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: TEST_EMAIL, password: 'wrongpassword' },
      remoteAddress: testIp(6),
    })
    const unknownEmail = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'unknown@example.com', password: TEST_PASSWORD },
      remoteAddress: testIp(7),
    })
    expect(wrongPassword.statusCode).toBe(401)
    expect(unknownEmail.statusCode).toBe(401)
    expect(wrongPassword.json()).toEqual(unknownEmail.json())
  })
})
