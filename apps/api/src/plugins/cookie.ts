import type { FastifyInstance } from 'fastify'
import fastifyCookie from '@fastify/cookie'

/**
 * Register @fastify/cookie — decorates request.cookies.
 * MUST be registered before @fastify/jwt (Pattern H — critical plugin order).
 */
export async function registerCookie(app: FastifyInstance): Promise<void> {
  await app.register(fastifyCookie)
}
