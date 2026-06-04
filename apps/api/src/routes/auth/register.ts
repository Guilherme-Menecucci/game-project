/**
 * POST /auth/register — Account registration (AUTH-02)
 *
 * Creates a new account row, hashes password with bcrypt (cost 12),
 * issues a 30-day persistent cookie, and sends a verification email
 * (D-09 / OQ-3 resolution: email sent but does not block registration).
 *
 * Rate limited to 10 req/min per IP (SEC-04, D-11).
 * Uses RegisterSchema from @game/shared for Zod validation before any DB op.
 */
import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { RegisterSchema } from '@game/shared'
import { db } from '../../db/client.js'
import { accounts } from '../../db/schema.js'
import { signRegisteredJwt } from '../../lib/auth.js'
import { issueRegisteredCookie } from '../../lib/cookies.js'
import { generateHexToken, VERIFY_TOKEN_TTL } from '../../lib/tokens.js'
import { redis } from '../../services/redis.js'
import { sendVerificationEmail } from '../../services/email.js'
import { env } from '../../env.js'

/**
 * Returns true if the error is a PostgreSQL unique constraint violation (code 23505).
 * Drizzle wraps the original PostgresError as a DrizzleQueryError with err.cause = PostgresError.
 */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as Record<string, unknown>
  // Direct code (postgres.js throws PostgresError directly in some paths)
  if (e['code'] === '23505') return true
  // Drizzle-wrapped: DrizzleQueryError.cause = PostgresError
  if (typeof e['cause'] === 'object' && e['cause'] !== null) {
    const cause = e['cause'] as Record<string, unknown>
    if (cause['code'] === '23505') return true
  }
  return false
}

export default async function registerRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/register',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      // Zod validation — runs before any DB operation (T-02-15 mitigate)
      const parsed = RegisterSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues })
      }

      const { email, password } = parsed.data

      // Hash password with cost factor 12 (T-02-16 mitigate — never store plaintext)
      const passwordHash = await bcrypt.hash(password, 12)

      // displayName: first part of email before @, trimmed, lowercase, max 20 chars
      const displayName = email.split('@')[0].slice(0, 20).toLowerCase()

      // Insert account row — catch unique violation for duplicate email
      let row: { id: string; displayName: string }
      try {
        const inserted = await db
          .insert(accounts)
          .values({ email, passwordHash, displayName })
          .returning({ id: accounts.id, displayName: accounts.displayName })
        row = inserted[0]
      } catch (err: unknown) {
        // Drizzle wraps PostgresError as DrizzleQueryError — check err.cause.code
        // for the original PostgreSQL error code (23505 = unique constraint violation)
        if (isUniqueViolation(err)) {
          return reply.code(409).send({ error: 'email_taken' })
        }
        throw err
      }

      // Sign JWT and issue 30-day persistent cookie (D-02)
      const token = signRegisteredJwt(app, row.id)
      issueRegisteredCookie(reply, token)

      // Send verification email — wrapped in try/catch so email failure does NOT fail
      // registration (D-09: account is immediately active). OQ-3 resolution.
      try {
        const verifyToken = generateHexToken(32)
        await redis.set(
          `verify:${verifyToken}`,
          JSON.stringify({ accountId: row.id, email }),
          'EX',
          VERIFY_TOKEN_TTL
        )
        const verifyLink = `${env.BASE_URL}/verify/${verifyToken}`
        await sendVerificationEmail(email, verifyLink)
      } catch {
        // Non-blocking: email failure does not fail registration
      }

      return reply.code(200).send({ userId: row.id, isGuest: false, displayName: row.displayName })
    }
  )
}
