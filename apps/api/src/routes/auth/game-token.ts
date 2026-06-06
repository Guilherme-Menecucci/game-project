/**
 * GET /auth/game-token — Token exchange endpoint (D-05)
 *
 * Validates the HttpOnly session cookie and returns a 5-minute game JWT
 * that the Phaser client passes to Colyseus to authenticate the WebSocket
 * connection. This bridges Phase 2 (session auth) and Phase 3 (game room auth).
 *
 * Security coverage:
 *   - T-3-03: Payload is { userId, type: 'game' } only — no session privileges;
 *             5-min expiry limits the attack window for stolen tokens.
 *   - T-3-03b: request.jwtVerify() validates HttpOnly cookie signature — unsigned
 *              or tampered cookies rejected with 401.
 *   - T-3-01: 10 req/min/IP rate limit prevents automated token farming;
 *             x-forwarded-for respected via @fastify/rate-limit configuration.
 *
 * All JWT signing via lib/auth.ts (Pattern I — never inline app.jwt.sign in handlers).
 */
import type { FastifyInstance } from 'fastify'
import { signGameJwt } from '../../lib/auth.js'

/** Shape of the decoded session JWT payload from @fastify/jwt */
interface SessionPayload {
  userId: string
}

/** Response body for GET /auth/game-token */
type GameTokenResponse = { token: string }

export default async function gameTokenRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Reply: GameTokenResponse }>(
    '/auth/game-token',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              token: { type: 'string' },
            },
            required: ['token'],
          },
        },
      },
    },
    async (request, reply) => {
      // Validate the session cookie. jwtVerify() reads 'session' cookie (configured
      // in jwt plugin) and verifies signature + expiry. Throws on failure.
      try {
        await request.jwtVerify()
      } catch {
        return reply.code(401).send({ message: 'Unauthorized' } as never)
      }

      const { userId } = request.user as SessionPayload

      // Sign the 5-minute game JWT — delegate to lib/auth.ts (never inline jwt.sign here)
      const token = signGameJwt(app, userId)

      return reply.code(200).send({ token })
    }
  )
}
