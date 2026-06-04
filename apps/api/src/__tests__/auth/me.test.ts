import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../server.js'

describe('GET /auth/me', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns 401 when no session cookie is present', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
    })
    expect(response.statusCode).toBe(401)
  })

  it('returns 200 with guest session data after POST /auth/guest', async () => {
    // First, get a session cookie from POST /auth/guest
    const guestResponse = await app.inject({
      method: 'POST',
      url: '/auth/guest',
    })
    expect(guestResponse.statusCode).toBe(200)

    // Extract the session cookie
    const setCookieHeader = guestResponse.headers['set-cookie'] as string
    const sessionCookieMatch = setCookieHeader.match(/session=([^;]+)/)
    expect(sessionCookieMatch).not.toBeNull()
    const sessionCookieValue = sessionCookieMatch![1]

    // Use the extracted cookie to call /auth/me
    const meResponse = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        cookie: `session=${sessionCookieValue}`,
      },
    })
    expect(meResponse.statusCode).toBe(200)
  })

  it('returns userId and isGuest: true for guest session', async () => {
    // Get a guest session
    const guestResponse = await app.inject({
      method: 'POST',
      url: '/auth/guest',
    })
    const guestBody = guestResponse.json<{ userId: string; displayName: string }>()

    const setCookieHeader = guestResponse.headers['set-cookie'] as string
    const sessionCookieMatch = setCookieHeader.match(/session=([^;]+)/)
    const sessionCookieValue = sessionCookieMatch![1]

    const meResponse = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        cookie: `session=${sessionCookieValue}`,
      },
    })

    const body = meResponse.json<{ userId: string; isGuest: boolean; displayName?: string }>()
    expect(body.userId).toBe(guestBody.userId)
    expect(body.isGuest).toBe(true)
  })

  it('returns displayName for guest session', async () => {
    // Get a guest session
    const guestResponse = await app.inject({
      method: 'POST',
      url: '/auth/guest',
    })
    const guestBody = guestResponse.json<{ displayName: string }>()

    const setCookieHeader = guestResponse.headers['set-cookie'] as string
    const sessionCookieMatch = setCookieHeader.match(/session=([^;]+)/)
    const sessionCookieValue = sessionCookieMatch![1]

    const meResponse = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        cookie: `session=${sessionCookieValue}`,
      },
    })

    const body = meResponse.json<{ displayName?: string }>()
    expect(body.displayName).toBe(guestBody.displayName)
  })
})
