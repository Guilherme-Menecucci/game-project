/**
 * POST /auth/login — Account login (AUTH-03)
 *
 * Validates credentials using bcryptjs.compare(). Unknown email also runs
 * compare() against INVALID_HASH (constant-time, T-02-14 mitigate).
 * Wrong password and unknown email both return identical 401 response
 * to prevent user enumeration (T-02-17 mitigate).
 *
 * Security coverage:
 *   - T-02-13: Rate limited to 10/min per IP via @fastify/rate-limit (D-11)
 *   - T-02-14: INVALID_HASH ensures timing-safe response for unknown emails
 *   - T-02-17: Identical 401 body for wrong password and unknown email
 *   - SEC-05: HttpOnly cookie via issueRegisteredCookie (lib/cookies.ts)
 *
 * All JWT signing via lib/auth.ts; all cookie ops via lib/cookies.ts (Pattern I).
 */
import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { LoginSchema } from '@game/shared'
import { db } from '../../db/client.js'
import { accounts } from '../../db/schema.js'
import { INVALID_HASH, signRegisteredJwt } from '../../lib/auth.js'
import { issueRegisteredCookie } from '../../lib/cookies.js'

export default async function loginRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/login',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      // Zod validation
      const parsed = LoginSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues })
      }

      const { email, password } = parsed.data

      // Query account by email
      const rows = await db.select().from(accounts).where(eq(accounts.email, email)).limit(1)

      const row = rows[0]

      if (!row) {
        // Unknown email: run compare against INVALID_HASH for constant-time response
        // (T-02-14 mitigate — prevents timing-based user enumeration)
        await bcrypt.compare(password, INVALID_HASH)
        return reply.code(401).send({ error: 'invalid_credentials' })
      }

      // Known email: compare against stored hash
      const match = await bcrypt.compare(password, row.passwordHash)
      if (!match) {
        return reply.code(401).send({ error: 'invalid_credentials' })
      }

      // Valid credentials: sign JWT and issue 30-day persistent cookie (D-02)
      const token = signRegisteredJwt(app, row.id)
      issueRegisteredCookie(reply, token)

      return reply.code(200).send({ userId: row.id, isGuest: false, displayName: row.displayName })
    }
  )
}
