import { describe, it, expect } from 'vitest'
import { selectUpgradeOptions, applyUpgrade } from '../upgrades.js'
import { mulberry32 } from '../prng.js'
import type { PlainGameState } from '../state.js'

describe('selectUpgradeOptions', () => {
  it('returns exactly 3 options from the pool', () => {
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
            speed: 10000,
            weapons: ['magic_wand'],
            passives: [],
          },
        ],
      ]),
      enemies: new Map(),
      gems: new Map(),
      projectiles: new Map(),
      pickups: new Map(),
      prngSeed: 42,
    }
    const prng = mulberry32(42)
    const options = selectUpgradeOptions(state, 'p1', prng)
    expect(options.length).toBe(3)
  })

  it('excludes weapons when all 6 weapon slots are full (GAME-09)', () => {
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
            speed: 10000,
            weapons: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'],
            passives: [],
          },
        ],
      ]),
      enemies: new Map(),
      gems: new Map(),
      projectiles: new Map(),
      pickups: new Map(),
      prngSeed: 42,
    }
    const prng = mulberry32(42)
    const options = selectUpgradeOptions(state, 'p1', prng)
    const hasNewWeapon = options.some((opt) => opt.type === 'weapon_new')
    expect(hasNewWeapon).toBe(false)
  })

  it('excludes evolution when prerequisite passive is missing (GAME-10)', () => {
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
            speed: 10000,
            weapons: ['magic_wand'], // needs empty_tome passive to evolve to holy_wand
            passives: [],
          },
        ],
      ]),
      enemies: new Map(),
      gems: new Map(),
      projectiles: new Map(),
      pickups: new Map(),
      prngSeed: 42,
    }
    const prng = mulberry32(42)
    const options = selectUpgradeOptions(state, 'p1', prng)
    const hasHolyWand = options.some((opt) => opt.id === 'holy_wand')
    expect(hasHolyWand).toBe(false)
  })
})

describe('applyUpgrade', () => {
  it('adds new weapon to player.weapons array (D-10)', () => {
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
            speed: 10000,
            weapons: [],
            passives: [],
          },
        ],
      ]),
      enemies: new Map(),
      gems: new Map(),
      projectiles: new Map(),
      pickups: new Map(),
      prngSeed: 42,
    }
    const nextState = applyUpgrade(state, 'p1', 'magic_wand')
    const player = nextState.players.get('p1')!
    expect(player.weapons).toContain('magic_wand')
  })

  it('evolution replaces base weapon in-place (D-12)', () => {
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
            speed: 10000,
            weapons: ['magic_wand'],
            passives: ['empty_tome'],
          },
        ],
      ]),
      enemies: new Map(),
      gems: new Map(),
      projectiles: new Map(),
      pickups: new Map(),
      prngSeed: 42,
    }
    const nextState = applyUpgrade(state, 'p1', 'holy_wand')
    const player = nextState.players.get('p1')!
    expect(player.weapons).toContain('holy_wand')
    expect(player.weapons).not.toContain('magic_wand')
  })

  it('respects 6-slot cap — does not add 7th weapon (GAME-09)', () => {
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
            speed: 10000,
            weapons: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'],
            passives: [],
          },
        ],
      ]),
      enemies: new Map(),
      gems: new Map(),
      projectiles: new Map(),
      pickups: new Map(),
      prngSeed: 42,
    }
    const nextState = applyUpgrade(state, 'p1', 'magic_wand')
    const player = nextState.players.get('p1')!
    expect(player.weapons.length).toBe(6)
  })
})
