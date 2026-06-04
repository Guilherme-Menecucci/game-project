/**
 * Integration tests for POST /auth/register (AUTH-02)
 *
 * vi.mock('resend') is hoisted to verify the production sendVerificationEmail path
 * calls resend.emails.send() with correct args — per D-08 NOTE in services/email.ts.
 * NODE_ENV is 'test' (not 'development'), so the real send branch fires.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../server.js'
import { db } from '../../db/client.js'
import { accounts } from '../../db/schema.js'

// Hoist the send mock so vi.mock factory can close over it
const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn().mockResolvedValue({ data: { id: 'test-email-id' }, error: null }),
}))

// Mock resend at the package level — lets the real services/email.ts run
// but intercepts the HTTP send. This verifies the production code path (D-08 coverage).
vi.mock('resend', () => ({
  Resend: vi.fn(() => ({
    emails: {
      send: sendMock,
    },
  })),
}))

describe('POST /auth/register', () => {
  let app: FastifyInstance

  // Use unique IPs per test run to avoid rate-limit bucket bleed (process.pid pattern)
  const runId = process.pid % 65536
  const oct3 = Math.floor(runId / 256) % 256
  const oct4Base = runId % 256
  function testIp(offset: number): string {
    return `10.2.${oct3}.${(oct4Base + offset) % 256}`
  }
  const RATE_LIMIT_IP = `10.22.${oct3}.${oct4Base}`

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    // Clean test state — delete all accounts before each test
    await db.delete(accounts)
    vi.clearAllMocks()
  })

  it('returns 200 for valid credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'test@example.com', password: 'password123' },
      remoteAddress: testIp(1),
    })
    expect(response.statusCode).toBe(200)
  })

  it('returns Set-Cookie with Max-Age=2592000 (30-day persistent, D-02)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'register-cookie@example.com', password: 'password123' },
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
      url: '/auth/register',
      payload: { email: 'register-body@example.com', password: 'password123' },
      remoteAddress: testIp(3),
    })
    expect(response.statusCode).toBe(200)
    const body = response.json<{ userId: string; isGuest: boolean; displayName: string }>()
    expect(body.isGuest).toBe(false)
    expect(typeof body.userId).toBe('string')
    expect(typeof body.displayName).toBe('string')
    expect(body.displayName).toBe('register-body') // first part before @, max 20 chars
  })

  it('calls sendVerificationEmail → resend.emails.send() with a /verify/ link (D-08 production path)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'verify-test@example.com', password: 'password123' },
      remoteAddress: testIp(4),
    })
    expect(response.statusCode).toBe(200)
    // The production send path (NODE_ENV=test, not development) must be exercised
    expect(sendMock).toHaveBeenCalledOnce()
    const callArgs = sendMock.mock.calls[0][0] as { to: string; html: string; subject: string }
    expect(callArgs.to).toBe('verify-test@example.com')
    expect(callArgs.html).toMatch(/\/verify\//)
  })

  it('returns 409 for duplicate email', async () => {
    // First registration
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'dup@example.com', password: 'password123' },
      remoteAddress: testIp(5),
    })
    // Second registration with same email
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'dup@example.com', password: 'password123' },
      remoteAddress: testIp(6),
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'email_taken' })
  })

  it('returns 400 for invalid email format', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'not-an-email', password: 'password123' },
      remoteAddress: testIp(7),
    })
    expect(response.statusCode).toBe(400)
  })

  it('returns 400 for password shorter than 8 chars', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'short@example.com', password: 'pass' },
      remoteAddress: testIp(8),
    })
    expect(response.statusCode).toBe(400)
  })

  it('returns 400 for password longer than 72 chars (bcrypt 72-byte truncation guard)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'long@example.com', password: 'a'.repeat(73) },
      remoteAddress: testIp(9),
    })
    expect(response.statusCode).toBe(400)
  })

  it('rate limit: 11th request from same IP within 1 minute returns 429 (SEC-04)', async () => {
    let lastStatus = 0
    for (let i = 1; i <= 11; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: `ratelimit${i}@example.com`, password: 'password123' },
        remoteAddress: RATE_LIMIT_IP,
      })
      lastStatus = res.statusCode
    }
    expect(lastStatus).toBe(429)
  })
})
