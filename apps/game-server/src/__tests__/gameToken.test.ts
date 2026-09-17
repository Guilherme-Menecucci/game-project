/**
 * verifyGameToken unit tests (Phase 6, ROOM-11 / T-06-08).
 *
 * The game JWT minted by GET /auth/game-token now carries a server-attested
 * displayName. verifyGameToken must expose it, and must keep accepting tokens
 * minted before this change (no displayName claim) by applying the same
 * deterministic fallback label the api uses — so the lobby never shows an
 * empty name and rollout never breaks in-flight tokens.
 */
import { describe, it, expect } from 'vitest'
import jwt from 'jsonwebtoken'
import { fallbackDisplayName } from '@game/shared'
import { verifyGameToken } from '../lib/gameToken.js'

const SECRET = process.env['JWT_SECRET']!

describe('verifyGameToken displayName', () => {
  it('returns the displayName claim when present', () => {
    const token = jwt.sign({ userId: 'user-1', type: 'game', displayName: 'captain_gt' }, SECRET, {
      expiresIn: '5m',
    })
    const payload = verifyGameToken(token)
    expect(payload).toEqual({ userId: 'user-1', type: 'game', displayName: 'captain_gt' })
  })

  it('falls back to the deterministic guest label when the claim is absent (pre-Phase 6 tokens)', () => {
    const userId = 'abcdef12-3456-7890-abcd-ef1234567890'
    const token = jwt.sign({ userId, type: 'game' }, SECRET, { expiresIn: '5m' })
    const payload = verifyGameToken(token)
    expect(payload.userId).toBe(userId)
    expect(payload.displayName).toBe(fallbackDisplayName(userId))
    expect(payload.displayName).toBe('Player_abcde')
  })

  it('falls back when the claim is present but empty or not a string', () => {
    const userId = 'zyxwv-user'
    const empty = jwt.sign({ userId, type: 'game', displayName: '' }, SECRET, { expiresIn: '5m' })
    expect(verifyGameToken(empty).displayName).toBe('Player_zyxwv')

    const wrongType = jwt.sign({ userId, type: 'game', displayName: 42 }, SECRET, {
      expiresIn: '5m',
    })
    expect(verifyGameToken(wrongType).displayName).toBe('Player_zyxwv')
  })

  it('does not throw when a correctly-signed token has no userId claim', () => {
    // Unreachable without JWT_SECRET, but the fallback must never turn a
    // malformed-but-signed token into a TypeError.
    const token = jwt.sign({ type: 'game' }, SECRET, { expiresIn: '5m' })
    const payload = verifyGameToken(token)
    expect(payload.userId).toBe('')
    expect(payload.displayName).toBe('Player_')
  })

  it('still rejects non-game token types', () => {
    const token = jwt.sign({ userId: 'user-1', type: 'session', displayName: 'x' }, SECRET, {
      expiresIn: '5m',
    })
    expect(() => verifyGameToken(token)).toThrow('Invalid token type: expected game')
  })

  it('still rejects tokens signed with the wrong secret', () => {
    const token = jwt.sign(
      { userId: 'user-1', type: 'game' },
      'wrong-secret-that-is-long-enough-x',
      {
        expiresIn: '5m',
      }
    )
    expect(() => verifyGameToken(token)).toThrow()
  })
})
