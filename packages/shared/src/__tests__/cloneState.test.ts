import { describe, it, expect } from 'vitest'
import { cloneState } from '../simulateTick.js'
import type { PlainGameState, PlainBossState } from '../state.js'

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
