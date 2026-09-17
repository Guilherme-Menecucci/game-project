/**
 * Room code generator tests (Phase 6, ROOM-02).
 *
 * CONTEXT locked decision: private-room codes are 6 uppercase alphanumeric
 * characters with the four voice-ambiguous glyphs removed (0/O/1/I), e.g.
 * K7XQ2M. The alphabet is A-Z minus O/I (24 letters) + digits 2-9 (8) = 32.
 *
 * Plain unit test — no Colyseus boot() needed; generateRoomCode is pure
 * (Math.random is fine here: matchmaking runs OUTSIDE the deterministic sim).
 */
import { describe, it, expect } from 'vitest'
import { generateRoomCode, ROOM_CODE_ALPHABET } from '../lib/roomCode.js'

const AMBIGUOUS = ['0', 'O', '1', 'I'] as const
const CODE_REGEX = /^[A-HJ-NP-Z2-9]{6}$/

describe('ROOM_CODE_ALPHABET (ROOM-02 locked alphabet)', () => {
  it('is exactly the 32-char unambiguous alphabet', () => {
    expect(ROOM_CODE_ALPHABET).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ23456789')
    expect(ROOM_CODE_ALPHABET).toHaveLength(32)
  })

  it('contains no ambiguous glyphs (0, O, 1, I)', () => {
    for (const glyph of AMBIGUOUS) {
      expect(ROOM_CODE_ALPHABET).not.toContain(glyph)
    }
  })

  it('has no duplicate characters', () => {
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(ROOM_CODE_ALPHABET.length)
  })

  it('is 24 uppercase letters + 8 digits', () => {
    const letters = ROOM_CODE_ALPHABET.replace(/[^A-Z]/g, '')
    const digits = ROOM_CODE_ALPHABET.replace(/[^0-9]/g, '')
    expect(letters).toHaveLength(24)
    expect(digits).toBe('23456789')
  })
})

describe('generateRoomCode()', () => {
  it('returns a 6-char string', () => {
    const code = generateRoomCode()
    expect(typeof code).toBe('string')
    expect(code).toHaveLength(6)
  })

  it('matches /^[A-HJ-NP-Z2-9]{6}$/', () => {
    expect(generateRoomCode()).toMatch(CODE_REGEX)
  })

  it('every char is drawn from ROOM_CODE_ALPHABET', () => {
    const code = generateRoomCode()
    for (const ch of code) {
      expect(ROOM_CODE_ALPHABET).toContain(ch)
    }
  })

  it('over 1000 codes: all valid, none ambiguous, not constant', () => {
    const codes = Array.from({ length: 1000 }, () => generateRoomCode())

    for (const code of codes) {
      expect(code).toMatch(CODE_REGEX)
      for (const glyph of AMBIGUOUS) {
        expect(code).not.toContain(glyph)
      }
    }

    // 32^6 space — 1000 draws collapsing to a single value means a broken RNG loop
    expect(new Set(codes).size).toBeGreaterThan(1)
  })
})

describe('code regex sanity (guards the test itself)', () => {
  it('rejects codes containing an ambiguous glyph', () => {
    for (const glyph of AMBIGUOUS) {
      expect(`ABCDE${glyph}`).not.toMatch(CODE_REGEX)
    }
  })

  it('rejects lowercase and wrong lengths', () => {
    expect('abcdef').not.toMatch(CODE_REGEX)
    expect('ABCDE').not.toMatch(CODE_REGEX)
    expect('ABCDEFG').not.toMatch(CODE_REGEX)
  })

  it('accepts every alphabet character in a code position', () => {
    for (const ch of ROOM_CODE_ALPHABET) {
      expect(`${ch}${ch}${ch}${ch}${ch}${ch}`).toMatch(CODE_REGEX)
    }
  })
})
