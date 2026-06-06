/**
 * Game JWT verification for Colyseus onAuth.
 *
 * The game JWT is issued by Fastify GET /auth/game-token (plan 03-03).
 * Payload: { userId: string, type: 'game', iat: number, exp: number }
 * Expiry: 5 minutes (single-session scope).
 *
 * Security: Always go through env.JWT_SECRET (not bare process.env).
 * This ensures startup fails loudly if JWT_SECRET is misconfigured (T-3-03 mitigation).
 */
import jwt from 'jsonwebtoken'
import { env } from './env.js'

export interface GameTokenPayload {
  userId: string
  type: 'game'
}

/**
 * Verify a game JWT and return its payload.
 * Throws JsonWebTokenError or TokenExpiredError on invalid/expired tokens.
 * Throws Error('Invalid token type: expected game') if type !== 'game'.
 */
export function verifyGameToken(token: string): GameTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as {
    userId: string
    type: string
    iat: number
    exp: number
  }

  if (decoded.type !== 'game') {
    throw new Error('Invalid token type: expected game')
  }

  return { userId: decoded.userId, type: 'game' }
}
