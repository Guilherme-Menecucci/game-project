/**
 * POST /auth/guest — Guest session creation (AUTH-01)
 *
 * Creates a guest session without requiring registration. Issues an HttpOnly
 * session cookie containing a JWT. No database row is created (per D-07).
 *
 * Rate limited to 20 req/min per IP (SEC-04, D-11).
 */
import { randomUUID, randomBytes } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { signGuestJwt } from '../../lib/auth.js'
import { issueGuestCookie } from '../../lib/cookies.js'

export default async function guestRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/guest',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
        },
      },
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              userId: { type: 'string' },
              isGuest: { type: 'boolean' },
              displayName: { type: 'string' },
            },
            required: ['userId', 'isGuest', 'displayName'],
          },
        },
      },
    },
    async (_request, reply) => {
      // Generate a UUID for the guest user (never stored in DB per D-07)
      const userId = randomUUID()

      // Generate displayName: 'Guest_' + 4 lowercase hex chars (D-05)
      const displayName = 'Guest_' + randomBytes(2).toString('hex')

      // Sign a JWT with 1d expiry as a security backstop (OQ-4 resolution)
      const token = signGuestJwt(app, userId, displayName)

      // Set session cookie — no maxAge (session cookie per D-03), HttpOnly (SEC-05)
      issueGuestCookie(reply, token)

      return reply.code(200).send({ userId, isGuest: true, displayName })
    }
  )
}
