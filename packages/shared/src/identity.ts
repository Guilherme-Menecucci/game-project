/**
 * identity.ts — display-name fallback shared by the api (token minting) and
 * the game-server (token verification).
 *
 * Phase 6 (ROOM-11 / T-06-08): lobby names are server-attested — they travel
 * in the game JWT's displayName claim, never as a client-sent message. When a
 * session has no display name (a guest session minted without one, or a game
 * token minted before the claim existed), both sides derive the SAME label
 * from the userId so the name is deterministic, never empty, and identical
 * whether it was stamped by the api or recovered by the game-server.
 *
 * Format matches the guest-name convention from POST /auth/guest
 * ('Guest_' + short id) so fallback names look native in the lobby.
 */

/** Deterministic display-name fallback: 'Guest_' + first 5 chars of the userId. */
export function fallbackDisplayName(userId: string): string {
  return 'Guest_' + userId.slice(0, 5)
}
