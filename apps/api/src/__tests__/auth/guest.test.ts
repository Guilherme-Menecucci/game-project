import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../server.js'

// Generate unique IP addresses for this test run to prevent rate-limit bucket
// pollution between concurrent test files and repeated test runs.
// Uses process.pid (range 1-65535) mapped to last two octets of a 10.x.x.x address.
const runId = process.pid % 65536
const oct3 = Math.floor(runId / 256) % 256
const oct4Base = runId % 256
// Each test gets a distinct last octet offset; wrap around if needed
function testIp(offset: number): string {
  return `10.1.${oct3}.${(oct4Base + offset) % 256}`
}
// Dedicated IP for the rate-limit test (offset 100 to keep it far from the functional tests)
const RATE_LIMIT_TEST_IP = `10.99.${oct3}.${oct4Base}`

describe('POST /auth/guest', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns 200', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/guest',
      remoteAddress: testIp(1),
    })
    expect(response.statusCode).toBe(200)
  })

  it('sets a session cookie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/guest',
      remoteAddress: testIp(2),
    })
    expect(response.headers['set-cookie']).toMatch(/session=/)
  })

  it('cookie has HttpOnly flag', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/guest',
      remoteAddress: testIp(3),
    })
    const setCookie = response.headers['set-cookie'] as string
    expect(setCookie).toMatch(/HttpOnly/i)
  })

  it('cookie is session-scoped: no Max-Age or Expires (per D-03)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/guest',
      remoteAddress: testIp(4),
    })
    const setCookie = response.headers['set-cookie'] as string
    expect(setCookie).not.toMatch(/Max-Age/i)
    expect(setCookie).not.toMatch(/Expires/i)
  })

  it('returns body with userId, isGuest: true, displayName', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/guest',
      remoteAddress: testIp(5),
    })
    const body = response.json<{ userId: string; isGuest: boolean; displayName: string }>()
    expect(body.isGuest).toBe(true)
    expect(typeof body.userId).toBe('string')
    expect(typeof body.displayName).toBe('string')
  })

  it('userId is UUID format', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/guest',
      remoteAddress: testIp(6),
    })
    const body = response.json<{ userId: string }>()
    expect(body.userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('displayName matches Guest_XXXX pattern (4 lowercase hex chars per D-05)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/guest',
      remoteAddress: testIp(7),
    })
    const body = response.json<{ displayName: string }>()
    expect(body.displayName).toMatch(/^Guest_[0-9a-f]{4}$/)
  })

  it('rate limit: 21st request within 1 minute returns 429 (SEC-04)', async () => {
    // RATE_LIMIT_TEST_IP is unique per process invocation — no cross-run pollution.
    // Sends 21 sequential requests; the 21st must return 429 per D-11 (max 20/min).
    let lastStatus = 0
    for (let i = 1; i <= 21; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/guest',
        remoteAddress: RATE_LIMIT_TEST_IP,
      })
      lastStatus = res.statusCode
    }
    expect(lastStatus).toBe(429)
  })
})
