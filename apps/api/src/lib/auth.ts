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

/**
 * Sign a short-lived game JWT for Colyseus room authentication (D-05).
 * Payload: { userId, type: 'game', displayName }. Expiry: 5 minutes — single-session scope.
 *
 * Token exchange flow:
 *   1. Client calls GET /auth/game-token with session cookie → receives this token.
 *   2. Client passes token as client.auth.token to Colyseus room join.
 *   3. Colyseus Room validates token in static onAuth hook (plan 03-04).
 *
 * Payload is intentionally minimal: no role, no isGuest — no session privileges.
 * The 'type' field lets the Colyseus onAuth hook reject session tokens passed directly
 * (T-3-03 elevation-of-privilege mitigate).
 *
 * Phase 6 (ROOM-11 / T-06-08): displayName is the ONLY identity label the
 * game-server trusts for lobby names. It is resolved server-side by the
 * game-token route (session claim, account row, or deterministic fallback) —
 * never from a client-sent value — so the lobby shows server-attested names.
 */
export function signGameJwt(app: FastifyInstance, userId: string, displayName: string): string {
  // Type cast required: FastifyJWT.payload is constrained to session token shape
  // (defined in upgrade.ts module augmentation). The game token payload intentionally
  // omits session fields (isGuest, role) — cast bypasses the interface constraint
  // without widening it to a union that would break isGuest narrowing in upgrade.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return app.jwt.sign({ userId, type: 'game', displayName } as any, { expiresIn: '5m' })
}
