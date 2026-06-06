/**
 * POST /auth/logout — Session termination (AUTH-06)
 *
 * Clears the session cookie. Idempotent — returns 200 regardless of
 * whether a session cookie was present. No JWT verification required.
 *
 * Uses reply.clearCookie() to instruct the browser to remove the cookie.
 */
import type { FastifyInstance } from 'fastify'

export default async function logoutRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/logout',
    {
      // No schema needed — logout accepts any body (or none) and returns empty 200
    },
    async (_request, reply) => {
      // Clear the session cookie — safe to call even when no cookie is present
      reply.clearCookie('session', { path: '/' })
      return reply.code(200).send()
    }
  )
}
