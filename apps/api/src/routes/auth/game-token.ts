/**
 * GET /auth/game-token — Token exchange endpoint (D-05)
 *
 * Validates the HttpOnly session cookie and returns a 5-minute game JWT
 * that the Phaser client passes to Colyseus to authenticate the WebSocket
 * connection. This bridges Phase 2 (session auth) and Phase 3 (game room auth).
 *
 * Security coverage:
 *   - T-3-03: Payload is { userId, type: 'game', displayName } only — no session
 *             privileges; 5-min expiry limits the attack window for stolen tokens.
 *   - T-3-03b: request.jwtVerify() validates HttpOnly cookie signature — unsigned
 *              or tampered cookies rejected with 401.
 *   - T-3-01: 10 req/min/IP rate limit prevents automated token farming;
 *             x-forwarded-for respected via @fastify/rate-limit configuration.
 *   - T-06-08 (Phase 6): displayName is resolved HERE, server-side, from the
 *             verified session — guest sessions carry it in the cookie JWT,
 *             registered sessions are looked up in accounts by primary key,
 *             and anything else gets the deterministic fallback label. The
 *             client never supplies a name, so lobby names cannot be spoofed.
 *
 * All JWT signing via lib/auth.ts (Pattern I — never inline app.jwt.sign in handlers).
 */
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { fallbackDisplayName } from '@game/shared'
import { db } from '../../db/client.js'
import { accounts } from '../../db/schema.js'
import { signGameJwt } from '../../lib/auth.js'

/** Shape of the decoded session JWT payload from @fastify/jwt */
interface SessionPayload {
  userId: string
  isGuest: boolean
  displayName?: string
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

      const { userId, isGuest, displayName: sessionName } = request.user as SessionPayload

      // Resolve the server-attested display name (T-06-08):
      //   1. Guest sessions embed displayName in the session JWT (D-05).
      //   2. Registered session JWTs carry no name — read it from the account row.
      //   3. Anything still unresolved gets the deterministic fallback so the
      //      claim is never empty.
      let displayName = typeof sessionName === 'string' && sessionName.length > 0 ? sessionName : ''

      if (!displayName && !isGuest) {
        try {
          const rows = await db
            .select({ displayName: accounts.displayName })
            .from(accounts)
            .where(eq(accounts.id, userId))
            .limit(1)
          displayName = rows[0]?.displayName ?? ''
        } catch (err) {
          // A lookup failure must not block play — degrade to the fallback label.
          request.log.warn({ err, userId }, 'game-token: account displayName lookup failed')
        }
      }

      if (!displayName) {
        displayName = fallbackDisplayName(userId)
      }

      // Sign the 5-minute game JWT — delegate to lib/auth.ts (never inline jwt.sign here)
      const token = signGameJwt(app, userId, displayName)

      return reply.code(200).send({ token })
    }
  )
}
