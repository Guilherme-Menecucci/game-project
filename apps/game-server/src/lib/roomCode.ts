/**
 * Private-room shareable code generator (Phase 6, ROOM-02).
 *
 * CONTEXT locked decision: 6 uppercase alphanumeric characters with the four
 * voice-ambiguous glyphs removed (no 0/O/1/I), e.g. K7XQ2M — players read
 * these aloud to friends, so every glyph must be unmistakable.
 *
 * The code IS the Colyseus roomId: CoopRoom.onCreate (plan 06-08) sets
 * `this.roomId = generateRoomCode()` with a collision-retry loop against
 * matchMaker.getRoomById. That retry deliberately lives in CoopRoom so this
 * module stays a pure function with no matchmaker dependency.
 *
 * Randomness: Math.random is acceptable here. Matchmaking runs OUTSIDE the
 * deterministic simulation (the sim's seeded PRNG is untouched), and codes
 * are NOT security tokens — the 32^6 ≈ 1.07e9 space, the existing WS /
 * matchmake rate limits, and ephemeral rooms (codes die with the room) make
 * brute-force guessing impractical for v1 (threat register T-06-06: accept).
 */

/** A-Z minus O/I (24 letters) + digits 2-9 (8) = 32 unambiguous characters. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const ROOM_CODE_LENGTH = 6

/**
 * Generate a 6-char room code drawn only from ROOM_CODE_ALPHABET.
 * Matches /^[A-HJ-NP-Z2-9]{6}$/.
 */
export function generateRoomCode(): string {
  let code = ''
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)]
  }
  return code
}
