import { randomBytes } from 'crypto'

/**
 * Generate a cryptographically secure hex token.
 * @param bytes - Number of random bytes (token length = bytes * 2 hex chars)
 *                Use 32 for 256-bit password reset tokens (D-10)
 */
export function generateHexToken(bytes: number): string {
  return randomBytes(bytes).toString('hex')
}

/**
 * Password reset token TTL — 15 minutes in seconds (D-10).
 * Tokens stored in Redis with this TTL. Invalidated after first use.
 */
export const RESET_TOKEN_TTL = 900

/**
 * Email verification token TTL — 24 hours in seconds.
 */
export const VERIFY_TOKEN_TTL = 86400
