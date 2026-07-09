/**
 * Security headers + CORS tests (Phase 6 Wave 0, T-06-03 mitigate).
 *
 * Proves the HTTP-layer hardening contract:
 * 1. @fastify/helmet defaults on every response (nosniff, frame-options, dns-prefetch-control)
 * 2. CORS pinned to the configured CORS_ORIGIN with credentials (HttpOnly cookie flows)
 * 3. Disallowed origins receive NO Access-Control-Allow-Origin header
 *    (array-form origin option — a static string would echo unconditionally,
 *    see @fastify/cors getAccessControlAllowOriginHeader)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../server.js'

// Mirror of env.ts CORS_ORIGIN default — setup.ts loads .env into process.env
// before this file runs, so this matches whatever env.ts validates.
const ALLOWED_ORIGIN = process.env['CORS_ORIGIN'] ?? 'http://localhost:5173'

describe('security headers (helmet)', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('sets x-content-type-options: nosniff on every route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
    })
    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })

  it('sets x-frame-options on every route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
    })
    expect(response.headers['x-frame-options']).toBeDefined()
  })

  it('sets x-dns-prefetch-control on every route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
    })
    expect(response.headers['x-dns-prefetch-control']).toBeDefined()
  })
})

describe('CORS (pinned origin + credentials)', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('preflight from the configured origin echoes that origin with credentials', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/auth/me',
      headers: {
        origin: ALLOWED_ORIGIN,
        'access-control-request-method': 'GET',
      },
    })
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN)
    expect(response.headers['access-control-allow-credentials']).toBe('true')
  })

  it('request from a disallowed origin gets NO access-control-allow-origin header', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        origin: 'https://evil.example.com',
      },
    })
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('preflight from a disallowed origin gets NO access-control-allow-origin header', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/auth/me',
      headers: {
        origin: 'https://evil.example.com',
        'access-control-request-method': 'GET',
      },
    })
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })
})
