import { describe, it, expect } from 'vitest'
import { applyPickupCollection } from '../weapons.js'
import { rollPickupDrop } from '../spawn.js'
import { mulberry32 } from '../prng.js'
import type { PlainGameState } from '../state.js'

describe('applyPickupCollection', () => {
  it('health_orb collected near player restores hp (GAME-17)', () => {
    const state: PlainGameState = {
      tick: 0,
      elapsedMs: 0,
      players: new Map([
        [
          'p1',
          {
            id: 'p1',
            x: 2000000,
            y: 2000000,
            hp: 50,
            maxHp: 100,
            level: 1,
            xp: 0,
            speed: 10000,
            weapons: [],
            passives: [],
          },
        ],
      ]),
      enemies: new Map(),
      gems: new Map(),
      projectiles: new Map(),
      pickups: new Map([
        [
          'pk1',
          {
            id: 'pk1',
            x: 2000000,
            y: 2000000,
            kind: 'health_orb',
          },
        ],
      ]),
      prngSeed: 42,
    }
    const nextState = applyPickupCollection(state)
    const player = nextState.players.get('p1')!
    expect(player.hp).toBeGreaterThan(50)
    expect(nextState.pickups.size).toBe(0)
  })

  it('xp_magnet moves all gems to player position', () => {
    const state: PlainGameState = {
      tick: 0,
      elapsedMs: 0,
      players: new Map([
        [
          'p1',
          {
            id: 'p1',
            x: 2000000,
            y: 2000000,
            hp: 100,
            maxHp: 100,
            level: 1,
            xp: 0,
            speed: 10000,
            weapons: [],
            passives: [],
          },
        ],
      ]),
      enemies: new Map(),
      gems: new Map([
        ['gem1', { id: 'gem1', x: 2100000, y: 2100000, value: 1 }],
        ['gem2', { id: 'gem2', x: 1900000, y: 1900000, value: 1 }],
      ]),
      projectiles: new Map(),
      pickups: new Map([
        [
          'pk1',
          {
            id: 'pk1',
            x: 2000000,
            y: 2000000,
            kind: 'xp_magnet',
          },
        ],
      ]),
      prngSeed: 42,
    }
    const nextState = applyPickupCollection(state)
    const gem1 = nextState.gems.get('gem1')!
    const gem2 = nextState.gems.get('gem2')!
    expect(gem1.x).toBe(2000000)
    expect(gem1.y).toBe(2000000)
    expect(gem2.x).toBe(2000000)
    expect(gem2.y).toBe(2000000)
    expect(nextState.pickups.size).toBe(0)
  })

  it('screen_bomb removes all enemies from state', () => {
    const state: PlainGameState = {
      tick: 0,
      elapsedMs: 0,
      players: new Map([
        [
          'p1',
          {
            id: 'p1',
            x: 2000000,
            y: 2000000,
            hp: 100,
            maxHp: 100,
            level: 1,
            xp: 0,
            speed: 10000,
            weapons: [],
            passives: [],
          },
        ],
      ]),
      enemies: new Map([
        [
          'e1',
          {
            id: 'e1',
            x: 2050000,
            y: 2050000,
            hp: 10,
            maxHp: 10,
            archetype: 'swarmer',
            speed: 7500,
            lastFireTick: 0,
          },
        ],
      ]),
      gems: new Map(),
      projectiles: new Map(),
      pickups: new Map([
        [
          'pk1',
          {
            id: 'pk1',
            x: 2000000,
            y: 2000000,
            kind: 'screen_bomb',
          },
        ],
      ]),
      prngSeed: 42,
    }
    const nextState = applyPickupCollection(state)
    expect(nextState.enemies.size).toBe(0)
    expect(nextState.pickups.size).toBe(0)
  })
})

describe('rollPickupDrop', () => {
  it('swarmer enemy has 2% drop rate', () => {
    let drops = 0
    const trials = 10000
    const prng = mulberry32(101)
    for (let i = 0; i < trials; i++) {
      const drop = rollPickupDrop('swarmer', prng)
      if (drop !== null) {
        drops++
      }
    }
    // Expected drops ~ 200 (allow 1.5% to 2.5% for noise)
    expect(drops).toBeGreaterThanOrEqual(150)
    expect(drops).toBeLessThanOrEqual(250)
  })

  it('tank enemy has 8% drop rate', () => {
    let drops = 0
    const trials = 10000
    const prng = mulberry32(202)
    for (let i = 0; i < trials; i++) {
      const drop = rollPickupDrop('tank', prng)
      if (drop !== null) {
        drops++
      }
    }
    // Expected drops ~ 800 (allow 7% to 9% for noise)
    expect(drops).toBeGreaterThanOrEqual(700)
    expect(drops).toBeLessThanOrEqual(900)
  })
})
