/**
 * Integration tests for POST /auth/upgrade (AUTH-05)
 *
 * vi.mock('../../services/email.js') isolates Resend from these tests.
 * The register/upgrade calls would otherwise hit the real send path in test mode.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../server.js'
import { db } from '../../db/client.js'
import { accounts } from '../../db/schema.js'

// Isolate email service — upgrade tests don't verify the email send path
vi.mock('../../services/email.js', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}))

describe('POST /auth/upgrade', () => {
  let app: FastifyInstance

  // Use unique IPs per test run to avoid rate-limit bucket bleed
  const runId = process.pid % 65536
  const oct3 = Math.floor(runId / 256) % 256
  const oct4Base = runId % 256
  function testIp(offset: number): string {
    return `10.4.${oct3}.${(oct4Base + offset) % 256}`
  }

  /**
   * Helper: create a guest session and return the session cookie.
   */
  async function createGuestSession(ipOffset: number): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/guest',
      remoteAddress: testIp(ipOffset),
    })
    const setCookie = response.headers['set-cookie'] as string
    // Extract the session cookie value for subsequent requests
    const match = setCookie.match(/session=([^;]+)/)
    if (!match) throw new Error('No session cookie in guest response')
    return `session=${match[1]}`
  }

  /**
   * Helper: create a registered session cookie (non-guest JWT in cookie).
   */
  async function createRegisteredSession(email: string, ipOffset: number): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'password123' },
      remoteAddress: testIp(ipOffset),
    })
    const setCookie = response.headers['set-cookie'] as string
    const match = setCookie.match(/session=([^;]+)/)
    if (!match) throw new Error('No session cookie in register response')
    return `session=${match[1]}`
  }

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    // Clean test state before each test
    await db.delete(accounts)
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await db.delete(accounts)
  })

  it('returns 200 with new 30-day cookie for valid guest JWT (D-06)', async () => {
    const guestCookie = await createGuestSession(1)
    const response = await app.inject({
      method: 'POST',
      url: '/auth/upgrade',
      payload: { email: 'upgraded@example.com', password: 'newpassword123' },
      headers: { cookie: guestCookie },
      remoteAddress: testIp(2),
    })
    expect(response.statusCode).toBe(200)
    const setCookie = response.headers['set-cookie'] as string
    expect(setCookie).toMatch(/session=/)
    expect(setCookie).toMatch(/Max-Age=2592000/i)
  })

  it('new cookie is different from the guest session cookie', async () => {
    const guestCookie = await createGuestSession(3)
    const response = await app.inject({
      method: 'POST',
      url: '/auth/upgrade',
      payload: { email: 'upgraded2@example.com', password: 'newpassword123' },
      headers: { cookie: guestCookie },
      remoteAddress: testIp(4),
    })
    expect(response.statusCode).toBe(200)
    const newCookie = response.headers['set-cookie'] as string
    // Extract just the session token values for comparison
    const guestToken = guestCookie.replace('session=', '')
    const newTokenMatch = newCookie.match(/session=([^;]+)/)
    expect(newTokenMatch).not.toBeNull()
    expect(newTokenMatch![1]).not.toBe(guestToken)
  })

  it('returns body { userId, isGuest: false, displayName }', async () => {
    const guestCookie = await createGuestSession(5)
    const response = await app.inject({
      method: 'POST',
      url: '/auth/upgrade',
      payload: { email: 'upgraded3@example.com', password: 'newpassword123' },
      headers: { cookie: guestCookie },
      remoteAddress: testIp(6),
    })
    expect(response.statusCode).toBe(200)
    const body = response.json<{ userId: string; isGuest: boolean; displayName: string }>()
    expect(body.isGuest).toBe(false)
    expect(typeof body.userId).toBe('string')
    expect(typeof body.displayName).toBe('string')
  })

  it('returns 401 when no cookie (missing JWT)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/upgrade',
      payload: { email: 'noauth@example.com', password: 'newpassword123' },
      remoteAddress: testIp(7),
    })
    expect(response.statusCode).toBe(401)
  })

  it('returns 401 for non-guest JWT (isGuest: false)', async () => {
    const registeredCookie = await createRegisteredSession(
      'registered-trying-upgrade@example.com',
      8
    )
    const response = await app.inject({
      method: 'POST',
      url: '/auth/upgrade',
      payload: { email: 'another@example.com', password: 'newpassword123' },
      headers: { cookie: registeredCookie },
      remoteAddress: testIp(9),
    })
    expect(response.statusCode).toBe(401)
  })

  it('returns 409 for duplicate email', async () => {
    // Register an account first
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'taken@example.com', password: 'password123' },
      remoteAddress: testIp(10),
    })
    // Try to upgrade to the same email
    const guestCookie = await createGuestSession(11)
    const response = await app.inject({
      method: 'POST',
      url: '/auth/upgrade',
      payload: { email: 'taken@example.com', password: 'newpassword123' },
      headers: { cookie: guestCookie },
      remoteAddress: testIp(12),
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'email_taken' })
  })
})
