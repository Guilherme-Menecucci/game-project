/**
 * Email verification route (D-09 / OQ-3 resolution)
 *
 * GET /auth/verify/:token
 *   Reads a verify token from Redis, sets verifiedAt timestamp, redirects to /.
 *   Invalid or expired tokens redirect to /?verified=false (T-02-23 mitigate).
 *   Token is single-use: deleted from Redis after first successful verify (T-02-23).
 *
 * This route is the receiving end of the verify link emailed during registration
 * (POST /auth/register in 02-04 stores the verify token). This plan does NOT
 * modify register.ts — only implements the token redemption endpoint.
 *
 * Redis key pattern: 'verify:{token}' → JSON({ accountId }), TTL=VERIFY_TOKEN_TTL (86400s)
 * Token format: generateHexToken(32) = 64-char hex string (256-bit entropy)
 */
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { redis } from '../../services/redis.js'
import { db } from '../../db/client.js'
import { accounts } from '../../db/schema.js'

export default async function verifyEmailRoute(app: FastifyInstance): Promise<void> {
  /**
   * GET /auth/verify/:token
   * Validates the email verification token and marks the account as verified.
   * Redirects to / on success, /?verified=false on invalid/expired token.
   * No authentication required — user arrives via email link.
   */
  app.get('/auth/verify/:token', async (request, reply) => {
    const { token } = request.params as { token: string }

    // Look up verify token in Redis
    const stored = await redis.get(`verify:${token}`)
    if (!stored) {
      // Invalid or expired token — redirect without exposing reason (T-02-23)
      return reply.redirect('/?verified=false')
    }

    const { accountId } = JSON.parse(stored) as { accountId: string }

    // Mark account as verified with current timestamp (D-09)
    await db.update(accounts).set({ verifiedAt: new Date() }).where(eq(accounts.id, accountId))

    // Delete token — single-use (T-02-23 mitigate)
    await redis.del(`verify:${token}`)

    // Redirect to root on success
    return reply.redirect('/')
  })
}
