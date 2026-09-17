/**
 * Game JWT verification for Colyseus onAuth.
 *
 * The game JWT is issued by Fastify GET /auth/game-token (plan 03-03).
 * Payload: { userId: string, type: 'game', displayName: string, iat: number, exp: number }
 * Expiry: 5 minutes (single-session scope).
 *
 * Phase 6 (ROOM-11 / T-06-08): displayName is the server-attested lobby name.
 * It is optional on the wire so tokens minted before the claim existed still
 * verify during rollout; when absent (or not a non-empty string) the same
 * deterministic fallback the api uses is applied, so the returned payload
 * ALWAYS has a non-empty displayName.
 *
 * Security: Always go through env.JWT_SECRET (not bare process.env).
 * This ensures startup fails loudly if JWT_SECRET is misconfigured (T-3-03 mitigation).
 */
import jwt from 'jsonwebtoken'
import { fallbackDisplayName } from '@game/shared'
import { env } from './env.js'

export interface GameTokenPayload {
  userId: string
  type: 'game'
  /** Server-attested display name — never empty (fallback applied when absent). */
  displayName: string
}

/**
 * Verify a game JWT and return its payload.
 * Throws JsonWebTokenError or TokenExpiredError on invalid/expired tokens.
 * Throws Error('Invalid token type: expected game') if type !== 'game'.
 */
export function verifyGameToken(token: string): GameTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as {
    userId?: unknown
    type: string
    displayName?: unknown
    iat: number
    exp: number
  }

  if (decoded.type !== 'game') {
    throw new Error('Invalid token type: expected game')
  }

  // Guard the fallback input: a correctly-signed token with no userId claim
  // must not turn into a TypeError here (pre-Phase 6 behavior returned it as-is).
  const userId = typeof decoded.userId === 'string' ? decoded.userId : ''

  const displayName =
    typeof decoded.displayName === 'string' && decoded.displayName.length > 0
      ? decoded.displayName
      : fallbackDisplayName(userId)

  return { userId, type: 'game', displayName }
}
