/**
 * weaponStats RED stubs (GAME-16/D-21).
 *
 * PlainPlayerState.weaponStats is keyed by weapon-array SLOT INDEX
 * (string '0'-'5'), NOT weapon id — survives evolution/slot replacement.
 * simulateTick does not yet populate weaponStats (that's plan 05-06's job)
 * — these assertions are EXPECTED to fail RED.
 */
import { describe, it, expect } from 'vitest'
import { makeInitialState, simulateTick, mulberry32 } from '@game/shared'
import type { PlainGameState, PlainEnemyState, PlayerInput } from '@game/shared'

const SEED = 777

function stateWithAdjacentEnemy(): PlainGameState {
  const state = makeInitialState(SEED)
  const p1 = state.players.get('p1')!
  // Slot 0 = garlic (instant AoE, no projectile travel needed), slot 1 = knife.
  p1.weapons = ['garlic', 'knife']

  const enemy: PlainEnemyState = {
    id: 'e1',
    x: p1.x,
    y: p1.y,
    hp: 1000,
    maxHp: 1000,
    archetype: 'swarmer',
    speed: 0,
    lastFireTick: 0,
  }
  state.enemies.set('e1', enemy)
  return state
}

function runTicks(state: PlainGameState, ticks: number): PlainGameState {
  let s = state
  const prng = mulberry32(SEED)
  const noInputs = new Map<string, PlayerInput>()
  for (let i = 0; i < ticks; i++) {
    s = simulateTick(s, noInputs, prng)
  }
  return s
}

describe('weaponStats accumulation (slot-indexed, D-21)', () => {
  it('player.weaponStats is keyed by slot index, not weapon id', () => {
    const state = stateWithAdjacentEnemy()
    // 25 ticks covers at least two garlic cooldown cycles (fireRateTicks=10),
    // guaranteeing a collision against the adjacent enemy.
    const after = runTicks(state, 25)
    const player = after.players.get('p1')!
    const keys = Object.keys(player.weaponStats ?? {})

    // RED: weaponStats is never populated yet, so this is empty — the
    // GREEN implementation (plan 05-06) must populate at least one slot.
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(['0', '1', '2', '3', '4', '5']).toContain(key)
    }
    expect(keys).not.toContain('magic_wand')
    expect(keys).not.toContain('garlic')
    expect(keys).not.toContain('knife')
  })

  it('totalDamage accumulates across ticks for the same slot', () => {
    const state = stateWithAdjacentEnemy()
    const after10 = runTicks(state, 10)
    const after20 = runTicks(state, 20)

    const totalAfter10 = after10.players.get('p1')!.weaponStats?.['0']?.totalDamage ?? 0
    const totalAfter20 = after20.players.get('p1')!.weaponStats?.['0']?.totalDamage ?? 0

    // RED: both are 0 today (weaponStats never populated) — monotonic
    // increase requires GREEN implementation.
    expect(totalAfter20).toBeGreaterThan(totalAfter10)
  })

  it('acquiredAtMs is set once and does not change on subsequent ticks', () => {
    const state = stateWithAdjacentEnemy()
    const after1 = runTicks(state, 1)
    const after5 = runTicks(state, 5)

    const acquiredAt1 = after1.players.get('p1')!.weaponStats?.['0']?.acquiredAtMs
    const acquiredAt5 = after5.players.get('p1')!.weaponStats?.['0']?.acquiredAtMs

    // RED: both are undefined today — GREEN implementation must set
    // acquiredAtMs once on weapon acquisition and keep it stable.
    expect(acquiredAt1).toBeDefined()
    expect(acquiredAt1).toBe(acquiredAt5)
  })

  it('dps formula matches totalDamage / elapsed seconds since acquisition', () => {
    const state = stateWithAdjacentEnemy()
    const after = runTicks(state, 25)
    const player = after.players.get('p1')!
    const slot0 = player.weaponStats?.['0']

    // RED: slot0 is undefined today — GREEN implementation must populate
    // totalDamage and acquiredAtMs so dps can be derived as:
    //   dps = totalDamage / ((elapsedMs - acquiredAtMs) / 1000)
    expect(slot0).toBeDefined()
    const elapsedSec = (after.elapsedMs - (slot0?.acquiredAtMs ?? 0)) / 1000
    expect(elapsedSec).toBeGreaterThan(0)
    const dps = (slot0?.totalDamage ?? 0) / elapsedSec
    expect(dps).toBeGreaterThan(0)
  })
})
