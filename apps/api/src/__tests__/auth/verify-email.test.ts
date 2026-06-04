/**
 * Integration tests for GET /auth/verify/:token (D-09)
 *
 * Tests seed Redis directly with verify tokens and insert accounts via db.insert()
 * for isolation from the register route (per plan instruction: independent of 02-04).
 *
 * Uses real Redis (ioredis singleton) for direct token seeding.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { buildApp } from '../../server.js'
import { db } from '../../db/client.js'
import { accounts } from '../../db/schema.js'
import { redis } from '../../services/redis.js'
import bcrypt from 'bcryptjs'
import { VERIFY_TOKEN_TTL } from '../../lib/tokens.js'

// Mock resend at the package level to prevent ByteString errors from email service
vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = { send: vi.fn().mockResolvedValue({ data: { id: 'test-id' }, error: null }) }
  },
}))

describe('GET /auth/verify/:token', () => {
  let app: FastifyInstance
  let testAccountId: string
  const TEST_TOKEN = 'a'.repeat(64) // 64-char hex token
  const TEST_EMAIL = 'verify-test@example.com'

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    // Insert a test account directly via Drizzle (verifiedAt=null by default)
    const passwordHash = await bcrypt.hash('testpassword123', 12)
    const inserted = await db
      .insert(accounts)
      .values({
        email: TEST_EMAIL,
        passwordHash,
        displayName: 'verify-test',
      })
      .returning({ id: accounts.id })
    testAccountId = inserted[0].id

    // Seed Redis with a verify token pointing to this account
    await redis.set(
      `verify:${TEST_TOKEN}`,
      JSON.stringify({ accountId: testAccountId }),
      'EX',
      VERIFY_TOKEN_TTL
    )
  })

  afterEach(async () => {
    // Clean test state
    await db.delete(accounts)
    await redis.del(`verify:${TEST_TOKEN}`)
    await redis.flushdb()
    vi.clearAllMocks()
  })

  it('returns 302 redirect to / for valid token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/auth/verify/${TEST_TOKEN}`,
    })
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/')
  })

  it('sets verifiedAt timestamp in DB after valid verify (D-09)', async () => {
    await app.inject({
      method: 'GET',
      url: `/auth/verify/${TEST_TOKEN}`,
    })

    // Fetch the account from DB and check verifiedAt is set
    const rows = await db
      .select({ verifiedAt: accounts.verifiedAt })
      .from(accounts)
      .where(eq(accounts.id, testAccountId))

    expect(rows).toHaveLength(1)
    expect(rows[0].verifiedAt).not.toBeNull()
  })

  it('returns 302 redirect to /?verified=false for invalid token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/verify/invalidtoken123',
    })
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/?verified=false')
  })

  it('returns 302 redirect to /?verified=false after token is used (single-use, T-02-23)', async () => {
    // First use — consumes the token
    await app.inject({
      method: 'GET',
      url: `/auth/verify/${TEST_TOKEN}`,
    })

    // Second use — token deleted from Redis
    const response = await app.inject({
      method: 'GET',
      url: `/auth/verify/${TEST_TOKEN}`,
    })
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/?verified=false')
  })
})
