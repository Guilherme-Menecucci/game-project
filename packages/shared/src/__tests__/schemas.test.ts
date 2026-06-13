/**
 * PlayerInputSchema hardening tests (security: non-finite input).
 *
 * Bare z.number() rejects NaN but ACCEPTS Infinity. An Infinity moveVector
 * component flows into simulateTick's normalization (vx = dx*speed/mag) and
 * produces NaN, which permanently corrupts the player's integer position.
 * Colyseus messages travel over msgpack, which preserves non-finite floats,
 * so a malicious client can reach this path. The schema must reject it.
 */
import { describe, it, expect } from 'vitest'
import { PlayerInputSchema, simulateTick, makeInitialState, mulberry32 } from '@game/shared'

describe('PlayerInputSchema rejects non-finite values', () => {
  const base = { moveVector: { x: 0, y: 0 }, aimAngle: 0, actionFlags: 0, seq: 0, tick: 0 }

  it('rejects Infinity in moveVector.x', () => {
    expect(
      PlayerInputSchema.safeParse({ ...base, moveVector: { x: Infinity, y: 0 } }).success
    ).toBe(false)
  })

  it('rejects -Infinity in moveVector.y', () => {
    expect(
      PlayerInputSchema.safeParse({ ...base, moveVector: { x: 0, y: -Infinity } }).success
    ).toBe(false)
  })

  it('rejects NaN in moveVector', () => {
    expect(PlayerInputSchema.safeParse({ ...base, moveVector: { x: NaN, y: 0 } }).success).toBe(
      false
    )
  })

  it('rejects Infinity aimAngle', () => {
    expect(PlayerInputSchema.safeParse({ ...base, aimAngle: Infinity }).success).toBe(false)
  })

  it('still accepts ordinary finite input', () => {
    expect(PlayerInputSchema.safeParse({ ...base, moveVector: { x: 0.7, y: -0.3 } }).success).toBe(
      true
    )
  })
})

describe('simulateTick is immune to non-finite moveVector', () => {
  it('keeps player position finite when fed an Infinity move vector', () => {
    const state = makeInitialState(1)
    const [playerId] = [...state.players.keys()]
    const player = state.players.get(playerId)!
    const startX = player.x
    const startY = player.y

    // Bypass TypeScript to mimic a malicious raw message reaching the sim.
    const malicious = {
      moveVector: { x: Infinity, y: Infinity },
      aimAngle: 0,
      actionFlags: 0,
    } as never
    const inputs = new Map([[playerId, malicious]])

    const next = simulateTick(state, inputs, mulberry32(1))
    const np = next.players.get(playerId)!

    expect(Number.isFinite(np.x)).toBe(true)
    expect(Number.isFinite(np.y)).toBe(true)
    // Non-finite input is dropped → no movement applied
    expect(np.x).toBe(startX)
    expect(np.y).toBe(startY)
  })
})
