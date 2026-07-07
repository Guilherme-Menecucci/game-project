/**
 * PlainGameState and related entity types.
 * makeInitialState(seed) creates a fresh run state.
 *
 * IMPORTANT: makeInitialState creates one player ('p1') for single-player
 * runs. The movement tests require at least one player to exist.
 * Position defaults to world center (2,048,000 sub-units).
 */

import { WORLD_W, WORLD_H } from './spatialGrid.js'

export type PlainPickupState = {
  id: string
  x: number
  y: number
  kind: 'health_orb' | 'xp_magnet' | 'screen_bomb'
}

export type PlainPlayerState = {
  id: string
  x: number
  y: number
  hp: number
  maxHp: number
  level: number
  xp: number
  speed: number
  weapons: string[]
  passives: string[]
  // Phase 5: character class identity (CHAR-01/02/03). Default 'human'.
  classId?: 'vampire' | 'human' | 'dwarf'
  // Phase 5: class-based stat multipliers (D-03/D-04). Default 1.0.
  damageMultiplier?: number
  fireRateMultiplier?: number
  // Phase 5: per-slot weapon damage tracking, keyed by weapon-array SLOT INDEX
  // (string '0'-'5'), NOT weapon id — survives evolution/slot replacement (D-21).
  // Default {}.
  weaponStats?: Record<string, { totalDamage: number; acquiredAtMs: number }>
}

export type PlainEnemyState = {
  id: string
  x: number
  y: number
  hp: number
  maxHp: number
  archetype: 'swarmer' | 'tank' | 'ranged'
  speed: number
  lastFireTick: number
  // Phase 5: set true when this enemy was spawned as a milestone elite.
  isElite?: boolean
  // Phase 5: display name shown when isElite is true (e.g. "Stitched Orderly").
  eliteName?: string
}

// Phase 5: milestone boss entity (biome boss / final boss). Lives in
// PlainGameState.bosses, separate from the regular `enemies` map — boss
// deaths do NOT increment `kills`.
export type PlainBossState = {
  id: string
  bossKey: 'patient_zero' | 'unfinished_one'
  name: string
  x: number
  y: number
  hp: number
  maxHp: number
  speed: number
  telegraphState?: 'idle' | 'telegraphing' | 'attacking'
  telegraphTick?: number
}

export type PlainGemState = {
  id: string
  x: number
  y: number
  value: number
}

export type PlainProjectileState = {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  ownerId: string
  isEnemy: boolean
  damage: number
  lifetime: number
  // Phase 5: slot index (string) into owner's player.weapons array for the
  // weapon that created this projectile. Used by applyCollisions to accumulate
  // damage into player.weaponStats[weaponSlot] (D-21 / GAME-16).
  weaponSlot?: string
}

export type PlainGameState = {
  tick: number
  elapsedMs: number
  players: Map<string, PlainPlayerState>
  enemies: Map<string, PlainEnemyState>
  gems: Map<string, PlainGemState>
  projectiles: Map<string, PlainProjectileState>
  pickups: Map<string, PlainPickupState>
  prngSeed: number
  // Phase 5: enemy kills (NOT boss deaths — see PlainBossState). Default 0.
  kills?: number
  // Phase 5: milestone bosses (biome boss / final boss). Default new Map().
  bosses?: Map<string, PlainBossState>
  // Phase 5: which milestone events have already fired. Keys: 'elite1',
  // 'elite2', 'elite3', 'elite4', 'biomeBoss', 'finalBoss'. Default {}.
  milestonesSpawned?: Record<string, boolean>
  // Phase 5: run outcome (GAME-12). Set to 'defeated' inside simulateTick
  // when any player's hp reaches 0. 'survived' is set by SoloRoom on
  // disconnect/leave in a later wave, never inside simulateTick.
  result?: 'survived' | 'defeated' | undefined
}

/**
 * Create a fresh PlainGameState for a run.
 * Seeds one player ('p1') at world center so the movement tests work.
 * SPEED_SUBUNITS per tick = 10,000 (200 game-units/sec at 20Hz).
 */
export function makeInitialState(seed: number): PlainGameState {
  const centerX = Math.floor(WORLD_W / 2)
  const centerY = Math.floor(WORLD_H / 2)

  const p1: PlainPlayerState = {
    id: 'p1',
    x: centerX,
    y: centerY,
    hp: 100,
    maxHp: 100,
    level: 1,
    xp: 0,
    speed: 10_000, // sub-units per tick at 20Hz
    weapons: [],
    passives: [],
    classId: 'human',
    damageMultiplier: 1.0,
    fireRateMultiplier: 1.0,
    weaponStats: {},
  }

  return {
    tick: 0,
    elapsedMs: 0,
    players: new Map([['p1', p1]]),
    enemies: new Map(),
    gems: new Map(),
    projectiles: new Map(),
    pickups: new Map(),
    prngSeed: seed,
    kills: 0,
    bosses: new Map(),
    milestonesSpawned: {},
    result: undefined,
  }
}
