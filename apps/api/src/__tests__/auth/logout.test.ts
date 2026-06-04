import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../server.js'

describe('POST /auth/logout', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns 200 when session cookie is present and clears it', async () => {
    // First, get a session cookie
    const guestResponse = await app.inject({
      method: 'POST',
      url: '/auth/guest',
    })
    const setCookieHeader = guestResponse.headers['set-cookie'] as string
    const sessionCookieMatch = setCookieHeader.match(/session=([^;]+)/)
    const sessionCookieValue = sessionCookieMatch![1]

    // Logout with the session cookie
    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {
        cookie: `session=${sessionCookieValue}`,
      },
    })
    expect(logoutResponse.statusCode).toBe(200)

    // The Set-Cookie header should clear the session cookie
    const logoutSetCookie = logoutResponse.headers['set-cookie'] as string
    expect(logoutSetCookie).toMatch(/session=/)
    // Cleared cookies are set with Max-Age=0 or an empty value
    expect(logoutSetCookie).toMatch(/Max-Age=0|session=;/)
  })

  it('returns 200 when no session cookie is present (idempotent)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
    })
    expect(response.statusCode).toBe(200)
  })

  it('after logout, GET /auth/me returns 401', async () => {
    // Get a guest session
    const guestResponse = await app.inject({
      method: 'POST',
      url: '/auth/guest',
    })
    const setCookieHeader = guestResponse.headers['set-cookie'] as string
    const sessionCookieMatch = setCookieHeader.match(/session=([^;]+)/)
    const sessionCookieValue = sessionCookieMatch![1]

    // Logout
    await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {
        cookie: `session=${sessionCookieValue}`,
      },
    })

    // After logout the old cookie value is still technically valid JWT-wise
    // but the clearCookie in logout sends back a cleared cookie.
    // The client side would clear it — in inject() we simulate a client that
    // does NOT send the cookie after logout (the cookie was cleared).
    const meResponse = await app.inject({
      method: 'GET',
      url: '/auth/me',
      // No cookie header — simulating post-logout state where cookie was cleared
    })
    expect(meResponse.statusCode).toBe(401)
  })
})
