/**
 * simulateTick determinism tests (SC-2)
 *
 * Verifies that simulateTick is a pure function: identical seeds produce
 * byte-identical JSON output. Required for anti-cheat server-side replay
 * validation and client-side prediction reconciliation.
 *
 * RED phase: all tests fail with 'not implemented' — stubs are in index.ts.
 * GREEN phase: plan 03-02 implements simulateTick, makeInitialState, mulberry32.
 */
import { describe, it, expect } from 'vitest'
import { simulateTick, makeInitialState, mulberry32 } from '@game/shared'

describe('simulateTick determinism (SC-2)', () => {
  it('is deterministic: byte-identical output for same seed', () => {
    const state1 = makeInitialState(12345)
    const state2 = makeInitialState(12345)

    // Add weapons/passives to player state and a pickup to initial state
    for (const state of [state1, state2]) {
      const p = state.players.get('p1')!
      p.weapons = ['magic_wand']
      p.passives = []
      state.pickups.set('p-0', { id: 'p-0', x: 100, y: 100, kind: 'health_orb' })
    }

    const inputs = new Map()

    const result1 = simulateTick(state1, inputs, mulberry32(12345))
    const result2 = simulateTick(state2, inputs, mulberry32(12345))

    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2))

    // Verify pickups Map cloning correctness
    expect(result1.pickups.size).toBe(1)
    expect(result1.pickups.get('p-0')).toEqual({ id: 'p-0', x: 100, y: 100, kind: 'health_orb' })
  })

  it('does not mutate input state', () => {
    const state = makeInitialState(99)
    // Object.freeze ensures any mutation attempt throws a TypeError.
    // If simulateTick is pure (returns new state), this must not throw.
    Object.freeze(state)
    const inputs = new Map()
    const prng = mulberry32(99)

    // Should not throw — pure function creates new state without mutating input
    expect(() => simulateTick(state, inputs, prng)).not.toThrow(TypeError)
  })
})
