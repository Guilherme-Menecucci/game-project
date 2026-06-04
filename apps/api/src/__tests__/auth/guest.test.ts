import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../server.js'

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
    })
    expect(response.statusCode).toBe(200)
  })

  it('sets a session cookie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/guest',
    })
    expect(response.headers['set-cookie']).toMatch(/session=/)
  })

  it('cookie has HttpOnly flag', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/guest',
    })
    const setCookie = response.headers['set-cookie'] as string
    expect(setCookie).toMatch(/HttpOnly/i)
  })

  it('cookie is session-scoped: no Max-Age or Expires (per D-03)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/guest',
    })
    const setCookie = response.headers['set-cookie'] as string
    expect(setCookie).not.toMatch(/Max-Age/i)
    expect(setCookie).not.toMatch(/Expires/i)
  })

  it('returns body with userId, isGuest: true, displayName', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/guest',
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
    })
    const body = response.json<{ userId: string }>()
    expect(body.userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('displayName matches Guest_XXXX pattern (4 lowercase hex chars per D-05)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/guest',
    })
    const body = response.json<{ displayName: string }>()
    expect(body.displayName).toMatch(/^Guest_[0-9a-f]{4}$/)
  })

  it('rate limit: 21st request within 1 minute returns 429 (SEC-04)', async () => {
    // Use a dedicated IP so other tests don't pollute this bucket.
    // @fastify/rate-limit uses req.ip as the default key.
    // Fastify inject() uses '127.0.0.1' as the default remote address;
    // we override with a unique test IP via remoteAddress to isolate this test bucket.
    const testIp = '10.0.99.1'
    let lastStatus = 0
    for (let i = 1; i <= 21; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/guest',
        remoteAddress: testIp,
      })
      lastStatus = res.statusCode
    }
    expect(lastStatus).toBe(429)
  })
})
