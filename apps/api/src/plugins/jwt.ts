import type { FastifyInstance } from 'fastify'
import fastifyJwt from '@fastify/jwt'
import { env } from '../env.js'

/**
 * Register @fastify/jwt with HttpOnly cookie mode.
 * MUST be registered after @fastify/cookie (Pattern H — critical plugin order).
 *
 * CSRF: SameSite=Lax is the Phase 2 baseline. Full double-submit CSRF token deferred to a hardening phase.
 */
export async function registerJwt(app: FastifyInstance): Promise<void> {
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    cookie: {
      cookieName: 'session',
      signed: false,
    },
  })
}
