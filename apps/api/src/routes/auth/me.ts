/**
 * GET /auth/me — Session identity check (AUTH-04)
 *
 * Returns the current user's identity from the session cookie JWT.
 * Returns 401 if no valid session cookie is present.
 *
 * Uses request.jwtVerify() directly in the handler — @fastify/jwt does not
 * provide app.authenticate; that pattern requires a custom decorator.
 * This approach satisfies AUTH-04 without extra boilerplate.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

interface JwtPayload {
  userId: string
  isGuest: boolean
  displayName?: string
  role: string
}

export default async function meRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/auth/me',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              userId: { type: 'string' },
              isGuest: { type: 'boolean' },
              displayName: { type: 'string' },
            },
            required: ['userId', 'isGuest'],
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // jwtVerify() reads the 'session' cookie (configured in jwt plugin)
        // and verifies the JWT signature + expiry. Throws on failure.
        await request.jwtVerify()
      } catch {
        return reply.code(401).send({ message: 'Unauthorized' })
      }

      const user = request.user as JwtPayload

      // Return minimal identity — no passwordHash, no email, no raw JWT (T-02-12)
      const body: { userId: string; isGuest: boolean; displayName?: string } = {
        userId: user.userId,
        isGuest: user.isGuest,
      }

      // Only include displayName for guest sessions (it's embedded in the JWT)
      if (user.isGuest && user.displayName) {
        body.displayName = user.displayName
      }

      return reply.code(200).send(body)
    }
  )
}
