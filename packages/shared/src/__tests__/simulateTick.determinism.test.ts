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
import type { PlainGameState, PlainPlayerState } from '@game/shared'

// Forward-typed view of the Phase 6 coop state contract (typechecks at RED,
// redundant no-op after GREEN — see downed.test.ts).
type CoopState = PlainGameState & { mode?: 'solo' | 'coop'; playerCount?: number }
type CoopPlayer = PlainPlayerState & {
  downed?: boolean
  bleedOutRemainingMs?: number
  reviveProgressTicks?: number
  eliminated?: boolean
}

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

  it('coop downed+revive path is deterministic: byte-identical states every tick', () => {
    // Phase 6 (06-03): the downed → revive sequence must not introduce any
    // draw-order or clone drift. Two identical coop runs through a full
    // down + revive arc compare byte-identical each tick.
    const build = (): CoopState => {
      const state = makeInitialState(777) as CoopState
      state.mode = 'coop'
      state.playerCount = 2
      const p1 = state.players.get('p1')!
      p1.hp = 0 // downs on tick 1
      state.players.set('p2', {
        ...p1,
        id: 'p2',
        x: p1.x + 30_000, // inside REVIVE_RADIUS (40,000) — channels the revive
        hp: 100,
        weapons: [...p1.weapons],
        passives: [...p1.passives],
        weaponStats: {},
      })
      return state
    }

    let a: PlainGameState = build()
    let b: PlainGameState = build()
    const prngA = mulberry32(777)
    const prngB = mulberry32(777)
    const inputs = new Map()

    for (let i = 0; i < 70; i++) {
      a = simulateTick(a, inputs, prngA)
      b = simulateTick(b, inputs, prngB)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    }

    // Sanity: the arc actually happened — p1 was revived at 50% maxHp.
    const p1 = a.players.get('p1')! as CoopPlayer
    expect(p1.downed).toBe(false)
    expect(p1.hp).toBe(50)
    expect(a.result).toBeUndefined()
  })
})
