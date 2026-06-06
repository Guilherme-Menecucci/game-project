/**
 * PlainGameState and related entity types.
 * makeInitialState(seed) creates a fresh run state.
 *
 * IMPORTANT: makeInitialState creates one player ('p1') for single-player
 * runs. The movement tests require at least one player to exist.
 * Position defaults to world center (2,048,000 sub-units).
 */

import { WORLD_W, WORLD_H } from './spatialGrid.js'

export type PlainPlayerState = {
  id: string
  x: number
  y: number
  hp: number
  maxHp: number
  level: number
  xp: number
  speed: number
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
}

export type PlainGameState = {
  tick: number
  elapsedMs: number
  players: Map<string, PlainPlayerState>
  enemies: Map<string, PlainEnemyState>
  gems: Map<string, PlainGemState>
  projectiles: Map<string, PlainProjectileState>
  prngSeed: number
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
  }

  return {
    tick: 0,
    elapsedMs: 0,
    players: new Map([['p1', p1]]),
    enemies: new Map(),
    gems: new Map(),
    projectiles: new Map(),
    prngSeed: seed,
  }
}
