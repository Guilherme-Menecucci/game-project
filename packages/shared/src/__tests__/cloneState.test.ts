import { describe, it, expect } from 'vitest'
import { cloneState } from '../simulateTick.js'
import type { PlainGameState, PlainPlayerState, PlainBossState } from '../state.js'

// Forward-typed view of the Phase 6 coop state contract (typechecks at RED,
// redundant no-op after GREEN — see downed.test.ts).
type CoopState = PlainGameState & { mode?: 'solo' | 'coop'; playerCount?: number }
type CoopPlayer = PlainPlayerState & {
  downed?: boolean
  bleedOutRemainingMs?: number
  reviveProgressTicks?: number
  eliminated?: boolean
}

/**
 * Phase 5 extension to cloneState coverage. cloneState IS implemented in
 * this task (05-01 Task 1) — these tests are expected to PASS GREEN.
 */
describe('cloneState Phase 5 fields', () => {
  it('deep-clones bosses Map — mutating clone does not affect original', () => {
    const boss: PlainBossState = {
      id: 'boss1',
      bossKey: 'patient_zero',
      name: 'Patient Zero',
      x: 100,
      y: 100,
      hp: 5000,
      maxHp: 5000,
      speed: 5_000,
    }
    const state: PlainGameState = {
      tick: 0,
      elapsedMs: 0,
      players: new Map(),
      enemies: new Map(),
      gems: new Map(),
      projectiles: new Map(),
      pickups: new Map(),
      prngSeed: 42,
      kills: 0,
      bosses: new Map([['boss1', boss]]),
      milestonesSpawned: {},
      result: undefined,
    }

    const clone = cloneState(state)
    const clonedBoss = clone.bosses!.get('boss1')!
    clonedBoss.hp = 1

    expect(state.bosses!.get('boss1')!.hp).toBe(5000)
    expect(clone.bosses!.get('boss1')!.hp).toBe(1)
  })

  it('deep-clones weaponStats per-slot — mutating clone slot does not affect original', () => {
    const state: PlainGameState = {
      tick: 0,
      elapsedMs: 0,
      players: new Map([
        [
          'p1',
          {
            id: 'p1',
            x: 0,
            y: 0,
            hp: 100,
            maxHp: 100,
            level: 1,
            xp: 0,
            speed: 10_000,
            weapons: ['magic_wand'],
            passives: [],
            classId: 'human',
            damageMultiplier: 1.0,
            fireRateMultiplier: 1.0,
            weaponStats: { '0': { totalDamage: 100, acquiredAtMs: 0 } },
          },
        ],
      ]),
      enemies: new Map(),
      gems: new Map(),
      projectiles: new Map(),
      pickups: new Map(),
      prngSeed: 42,
      kills: 0,
      bosses: new Map(),
      milestonesSpawned: {},
      result: undefined,
    }

    const clone = cloneState(state)
    clone.players.get('p1')!.weaponStats!['0']!.totalDamage = 999

    expect(state.players.get('p1')!.weaponStats!['0']!.totalDamage).toBe(100)
    expect(clone.players.get('p1')!.weaponStats!['0']!.totalDamage).toBe(999)
  })

  it('milestonesSpawned is a fresh object reference', () => {
    const state: PlainGameState = {
      tick: 0,
      elapsedMs: 0,
      players: new Map(),
      enemies: new Map(),
      gems: new Map(),
      projectiles: new Map(),
      pickups: new Map(),
      prngSeed: 42,
      kills: 0,
      bosses: new Map(),
      milestonesSpawned: { elite1: true },
      result: undefined,
    }

    const clone = cloneState(state)

    expect(clone.milestonesSpawned).not.toBe(state.milestonesSpawned)
    expect(clone.milestonesSpawned).toEqual(state.milestonesSpawned)
  })

  it('kills and result are copied by value', () => {
    const state: PlainGameState = {
      tick: 0,
      elapsedMs: 0,
      players: new Map(),
      enemies: new Map(),
      gems: new Map(),
      projectiles: new Map(),
      pickups: new Map(),
      prngSeed: 42,
      kills: 5,
      bosses: new Map(),
      milestonesSpawned: {},
      result: 'defeated',
    }

    const clone = cloneState(state)

    expect(clone.kills).toBe(5)
    expect(clone.result).toBe('defeated')
  })
})

/**
 * Phase 6 (06-03) extension: every new PlainGameState/PlainPlayerState field
 * must survive cloneState (Pitfall 1 — a missed field silently disappears
 * after one tick).
 */
describe('cloneState Phase 6 fields', () => {
  function makePhase6State(): CoopState {
    const downedPlayer: CoopPlayer = {
      id: 'p1',
      x: 0,
      y: 0,
      hp: 0,
      maxHp: 100,
      level: 1,
      xp: 0,
      speed: 10_000,
      weapons: [],
      passives: [],
      classId: 'human',
      damageMultiplier: 1.0,
      fireRateMultiplier: 1.0,
      weaponStats: {},
      downed: true,
      bleedOutRemainingMs: 12_345,
      reviveProgressTicks: 7,
      eliminated: false,
    }
    const eliminatedPlayer: CoopPlayer = {
      ...downedPlayer,
      id: 'p2',
      downed: false,
      bleedOutRemainingMs: 0,
      reviveProgressTicks: 0,
      eliminated: true,
    }
    const state: CoopState = {
      tick: 0,
      elapsedMs: 0,
      players: new Map([
        ['p1', downedPlayer],
        ['p2', eliminatedPlayer],
      ]),
      enemies: new Map(),
      gems: new Map(),
      projectiles: new Map(),
      pickups: new Map(),
      prngSeed: 42,
      kills: 0,
      bosses: new Map(),
      milestonesSpawned: {},
      result: undefined,
      mode: 'coop',
      playerCount: 3,
    }
    return state
  }

  it('mode and playerCount survive cloning (top-level scalars)', () => {
    const state = makePhase6State()

    const clone = cloneState(state) as CoopState

    expect(clone.mode).toBe('coop')
    expect(clone.playerCount).toBe(3)
  })

  it('downed/bleedOutRemainingMs/reviveProgressTicks/eliminated survive cloning', () => {
    const state = makePhase6State()

    const clone = cloneState(state)
    const p1 = clone.players.get('p1')! as CoopPlayer
    const p2 = clone.players.get('p2')! as CoopPlayer

    expect(p1.downed).toBe(true)
    expect(p1.bleedOutRemainingMs).toBe(12_345)
    expect(p1.reviveProgressTicks).toBe(7)
    expect(p1.eliminated).toBe(false)
    expect(p2.eliminated).toBe(true)
  })

  it('mutating cloned downed fields does not affect the original', () => {
    const state = makePhase6State()

    const clone = cloneState(state)
    const clonedP1 = clone.players.get('p1')! as CoopPlayer
    clonedP1.downed = false
    clonedP1.bleedOutRemainingMs = 1

    const originalP1 = state.players.get('p1')! as CoopPlayer
    expect(originalP1.downed).toBe(true)
    expect(originalP1.bleedOutRemainingMs).toBe(12_345)
  })
})
