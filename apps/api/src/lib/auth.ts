import type { FastifyInstance } from 'fastify'

/**
 * A pre-computed invalid hash for constant-time timing safety in login.ts.
 * When the email is not found, run bcryptjs.compare(password, INVALID_HASH)
 * so the response time is indistinguishable from a real password compare.
 * This prevents user enumeration via timing differences.
 */
export const INVALID_HASH = '$2b$12$invalidhashfortimingsafety0000000'

/**
 * Sign a JWT for a registered account (D-01, D-02, D-04).
 * Payload: { userId, role: 'registered', isGuest: false }
 * Expiry: 30 days (matches registered cookie maxAge)
 */
export function signRegisteredJwt(app: FastifyInstance, userId: string): string {
  return app.jwt.sign({ userId, role: 'registered', isGuest: false }, { expiresIn: '30d' })
}

/**
 * Sign a JWT for a guest session (D-01, D-03, D-04, D-05).
 * Payload: { userId, role: 'guest', isGuest: true, displayName }
 * Expiry: 1 day — security backstop even though cookie is session-scoped (OQ-4)
 */
export function signGuestJwt(app: FastifyInstance, userId: string, displayName: string): string {
  return app.jwt.sign({ userId, role: 'guest', isGuest: true, displayName }, { expiresIn: '1d' })
}
