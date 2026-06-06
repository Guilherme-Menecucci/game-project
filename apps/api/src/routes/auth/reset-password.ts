/**
 * Password reset routes (AUTH-07)
 *
 * POST /auth/reset-password/request — request a reset link (D-10)
 *   Always returns 200 regardless of account existence (T-02-19: prevents user enumeration)
 *   Rate limited to 5 requests per 15 minutes per IP (D-11, SEC-04)
 *
 * POST /auth/reset-password/confirm — apply new password using reset token
 *   Token is single-use: deleted from Redis after first successful confirm (T-02-21)
 *
 * Redis key pattern: 'reset:{token}' → JSON({ accountId, email }), TTL=RESET_TOKEN_TTL (900s)
 * Token format: generateHexToken(32) = 64-char hex string (256-bit entropy, T-02-20)
 */
import type { FastifyInstance } from 'fastify'
import * as z from 'zod'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { generateHexToken, RESET_TOKEN_TTL } from '../../lib/tokens.js'
import { redis } from '../../services/redis.js'
import { sendPasswordResetEmail } from '../../services/email.js'
import { db } from '../../db/client.js'
import { accounts } from '../../db/schema.js'
import { env } from '../../env.js'

const RequestSchema = z.object({
  email: z.email(),
})

const ConfirmSchema = z.object({
  token: z.string(),
  password: z.string().min(8).max(72),
})

export default async function resetPasswordRoute(app: FastifyInstance): Promise<void> {
  /**
   * POST /auth/reset-password/request
   * Issues a reset token via email. Always returns 200 to prevent email enumeration.
   */
  app.post(
    '/auth/reset-password/request',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const parsed = RequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues })
      }

      const { email } = parsed.data

      // Lookup account — silently swallow "not found" (T-02-19: no enumeration)
      const rows = await db.select().from(accounts).where(eq(accounts.email, email))
      if (rows.length > 0) {
        const account = rows[0]
        const token = generateHexToken(32)
        // Store reset token in Redis with 15-minute TTL (D-10)
        await redis.set(
          `reset:${token}`,
          JSON.stringify({ accountId: account.id, email: account.email }),
          'EX',
          RESET_TOKEN_TTL
        )
        const resetLink = `${env.BASE_URL}/reset-password/${token}`
        // Fire-and-forget — email failure must not change response (T-02-22)
        sendPasswordResetEmail(account.email, resetLink).catch(() => {
          // Non-blocking: email failure does not affect response
        })
      }

      // Always same response regardless of account existence (T-02-19 mitigate)
      return reply
        .code(200)
        .send({ message: 'If an account exists for that address, a reset link is on its way.' })
    }
  )

  /**
   * POST /auth/reset-password/confirm
   * Validates the reset token, updates the password, and invalidates the token.
   */
  app.post('/auth/reset-password/confirm', async (request, reply) => {
    const parsed = ConfirmSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues })
    }

    const { token, password } = parsed.data

    // Retrieve token from Redis — null means expired or invalid (T-02-20)
    const stored = await redis.get(`reset:${token}`)
    if (!stored) {
      return reply.code(400).send({ error: 'invalid_or_expired_token' })
    }

    const { accountId } = JSON.parse(stored) as { accountId: string; email: string }

    // Hash new password with cost 12 (same as registration)
    const passwordHash = await bcrypt.hash(password, 12)

    // Update account password
    await db.update(accounts).set({ passwordHash }).where(eq(accounts.id, accountId))

    // Delete token immediately — single-use (T-02-21 mitigate)
    await redis.del(`reset:${token}`)

    return reply.code(200).send({ message: 'Password updated successfully' })
  })
}
