/**
 * GET /auth/game-token tests (D-05)
 *
 * Verifies:
 * 1. 401 when no session cookie present
 * 2. 200 valid guest session returns game JWT
 * 3. Returned token payload has { userId, type: 'game' } and short expiry
 * 4. Rate-limit: 429 on 11th request within window
 * 5. Phase 6 (ROOM-11 / T-06-08): payload carries a server-attested displayName —
 *    guest session name, registered account name (DB lookup), or the
 *    deterministic fallback label when the session has none. Never empty.
 *
 * RED phase: route doesn't exist yet → tests fail with 404.
 * GREEN phase: plan 03-03 creates GET /auth/game-token route.
 *
 * Uses IP prefix 10.5.X.X — distinct from:
 *   - 10.1.X.X (guest.test.ts)
 *   - 10.2.X.X (register/login tests)
 *   - 10.99.X.X (rate-limit tests in guest.test.ts)
 * This prevents rate-limit counter bleed across test files.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { fallbackDisplayName } from '@game/shared'
import { buildApp } from '../../server.js'
import { db } from '../../db/client.js'
import { accounts } from '../../db/schema.js'
import { signGuestJwt, signRegisteredJwt } from '../../lib/auth.js'

// IP generation: use process.pid for cross-run uniqueness (per STATE.md decision)
const runId = process.pid % 65536
const oct3 = Math.floor(runId / 256) % 256
const oct4Base = runId % 256

function testIp(offset: number): string {
  return `10.5.${oct3}.${(oct4Base + offset) % 256}`
}

// Dedicated rate-limit test IP — far from functional test IPs
const RATE_LIMIT_TEST_IP = `10.5.${(oct3 + 1) % 256}.${oct4Base}`

/** Decode a JWT payload without verifying the signature (structure checks only). */
function decodePayload(token: string): Record<string, unknown> {
  const [, payloadB64] = token.split('.')
  return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as Record<
    string,
    unknown
  >
}

describe('GET /auth/game-token', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('401 when no session cookie present', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/game-token',
      remoteAddress: testIp(1),
    })
    expect(response.statusCode).toBe(401)
  })

  it('200 valid guest session returns game JWT', async () => {
    // Sign a valid guest session cookie using the existing signGuestJwt helper
    const guestToken = signGuestJwt(app, 'test-user-id-12345', 'Guest_abcd')
    const response = await app.inject({
      method: 'GET',
      url: '/auth/game-token',
      remoteAddress: testIp(2),
      headers: {
        cookie: `session=${guestToken}`,
      },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json<{ token: string }>()
    expect(typeof body.token).toBe('string')
    expect(body.token.length).toBeGreaterThan(0)
  })

  it('returned token has correct payload: { userId, type: "game" }', async () => {
    const userId = 'test-user-id-67890'
    const guestToken = signGuestJwt(app, userId, 'Guest_efgh')
    const response = await app.inject({
      method: 'GET',
      url: '/auth/game-token',
      remoteAddress: testIp(3),
      headers: {
        cookie: `session=${guestToken}`,
      },
    })
    expect(response.statusCode).toBe(200)
    const { token } = response.json<{ token: string }>()

    // Decode the JWT payload (no signature verification — just check structure)
    const payload = decodePayload(token)

    expect(typeof payload['userId']).toBe('string')
    expect(payload['type']).toBe('game')

    // Token expiry should be within 5 minutes of now (300 seconds)
    const now = Math.floor(Date.now() / 1000)
    const exp = payload['exp'] as number
    expect(exp).toBeGreaterThan(now)
    expect(exp).toBeLessThanOrEqual(now + 300 + 5) // 5s buffer for test latency
  })

  describe('displayName claim (Phase 6, ROOM-11 / T-06-08)', () => {
    const registeredEmail = `game-token-${process.pid}@example.com`
    const registeredName = 'captain_gt'
    let registeredUserId = ''

    beforeAll(async () => {
      // Seed a real account row so the registered path can resolve the name.
      // Delete first so a crashed prior run cannot leave a duplicate email.
      await db.delete(accounts).where(eq(accounts.email, registeredEmail))
      const inserted = await db
        .insert(accounts)
        .values({ email: registeredEmail, passwordHash: 'x', displayName: registeredName })
        .returning({ id: accounts.id })
      registeredUserId = inserted[0].id
    })

    afterAll(async () => {
      await db.delete(accounts).where(eq(accounts.email, registeredEmail))
    })

    it('guest session: displayName equals the session displayName', async () => {
      const userId = 'guest-user-id-abcde'
      const guestToken = signGuestJwt(app, userId, 'Guest_efgh')
      const response = await app.inject({
        method: 'GET',
        url: '/auth/game-token',
        remoteAddress: testIp(4),
        headers: { cookie: `session=${guestToken}` },
      })
      expect(response.statusCode).toBe(200)
      const payload = decodePayload(response.json<{ token: string }>().token)
      expect(payload['displayName']).toBe('Guest_efgh')
      // Existing claims are untouched
      expect(payload['userId']).toBe(userId)
      expect(payload['type']).toBe('game')
      expect(payload['role']).toBeUndefined()
      expect(payload['isGuest']).toBeUndefined()
    })

    it('registered session: displayName equals the account display name', async () => {
      const sessionToken = signRegisteredJwt(app, registeredUserId)
      const response = await app.inject({
        method: 'GET',
        url: '/auth/game-token',
        remoteAddress: testIp(5),
        headers: { cookie: `session=${sessionToken}` },
      })
      expect(response.statusCode).toBe(200)
      const payload = decodePayload(response.json<{ token: string }>().token)
      expect(payload['displayName']).toBe(registeredName)
      expect(payload['userId']).toBe(registeredUserId)
      expect(payload['type']).toBe('game')

      // Expiry unchanged by the new claim: still 5 minutes
      const now = Math.floor(Date.now() / 1000)
      const exp = payload['exp'] as number
      expect(exp).toBeGreaterThan(now)
      expect(exp).toBeLessThanOrEqual(now + 300 + 5)
    })

    it('guest session without a displayName claim: deterministic fallback, never empty', async () => {
      const userId = 'abcdef12-3456-7890-abcd-ef1234567890'
      // Legacy/edge guest session minted without displayName (signGuestJwt always
      // sets one today, so build the cookie directly).
      const sessionToken = app.jwt.sign(
        { userId, role: 'guest', isGuest: true },
        { expiresIn: '1d' }
      )
      const response = await app.inject({
        method: 'GET',
        url: '/auth/game-token',
        remoteAddress: testIp(6),
        headers: { cookie: `session=${sessionToken}` },
      })
      expect(response.statusCode).toBe(200)
      const payload = decodePayload(response.json<{ token: string }>().token)
      expect(payload['displayName']).toBe(fallbackDisplayName(userId))
      expect(payload['displayName']).toBe('Player_abcde')
      expect((payload['displayName'] as string).length).toBeGreaterThan(0)
    })
  })

  it('rate limit: 429 on 11th request within window', async () => {
    // Game token route is rate-limited to 10 requests per minute (per D-05 spec)
    const guestToken = signGuestJwt(app, 'rate-limit-test-user', 'Guest_rl01')
    let lastStatus = 0

    for (let i = 1; i <= 11; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/game-token',
        remoteAddress: RATE_LIMIT_TEST_IP,
        headers: {
          cookie: `session=${guestToken}`,
        },
      })
      lastStatus = res.statusCode
    }

    expect(lastStatus).toBe(429)
  })
})
