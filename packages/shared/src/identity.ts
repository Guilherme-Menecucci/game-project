/**
 * identity.ts — display-name fallback shared by the api (token minting) and
 * the game-server (token verification).
 *
 * Phase 6 (ROOM-11 / T-06-08): lobby names are server-attested — they travel
 * in the game JWT's displayName claim, never as a client-sent message. When a
 * session has no display name (a guest session minted without one, a game
 * token minted before the claim existed, or a registered account whose row
 * could not be read), both sides derive the SAME label from the userId so the
 * name is deterministic, never empty, and identical whether it was stamped by
 * the api or recovered by the game-server.
 *
 * The prefix is deliberately NOT 'Guest_' (the POST /auth/guest convention):
 * an id-derived fallback must be distinguishable from a real guest name so a
 * registered player whose lookup failed is never displayed as a guest.
 */

/** Deterministic display-name fallback: 'Player_' + first 5 chars of the userId. */
export function fallbackDisplayName(userId: string): string {
  return 'Player_' + userId.slice(0, 5)
}
