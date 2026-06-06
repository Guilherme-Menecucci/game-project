/**
 * Ranged archetype behavior tests (GAME-05)
 *
 * Verifies:
 * 1. Ranged enemy moves away from player when inside KEEP_DISTANCE_INNER
 * 2. Ranged enemy fires isEnemy:true projectile at fire interval
 * 3. Ranged enemy does NOT fire before interval elapses
 *
 * Constants (will be exported from weapons.ts in plan 03-06):
 *   KEEP_DISTANCE_INNER = 120,000 sub-units
 *   ENEMY_FIRE_INTERVAL_TICKS = 20
 *
 * RED phase: all tests fail with 'not implemented'.
 * GREEN phase: plan 03-06 implements ranged archetype logic in simulateTick.
 */
import { describe, it, expect } from 'vitest'
import { simulateTick, makeInitialState, mulberry32 } from '@game/shared'
import type { PlainEnemyState, PlainGameState } from '@game/shared'

// Constants for ranged archetype (mirrored from plan 03-06 spec)
const KEEP_DISTANCE_INNER = 120_000 // sub-units
const ENEMY_FIRE_INTERVAL_TICKS = 20

// Helper: build a minimal state with one player and one ranged enemy
function makeRangedState(
  playerX: number,
  playerY: number,
  enemyX: number,
  enemyY: number,
  lastFireTick: number
): PlainGameState {
  const state = makeInitialState(1)

  // Get or create player
  const [playerId] = [...state.players.keys()]
  const player = state.players.get(playerId)!
  player.x = playerX
  player.y = playerY

  // Add ranged enemy
  const enemy: PlainEnemyState = {
    id: 'ranged-1',
    x: enemyX,
    y: enemyY,
    hp: 20,
    maxHp: 20,
    archetype: 'ranged',
    speed: 100_000, // 100 game-units/sec in sub-units
    lastFireTick,
  }
  state.enemies.set('ranged-1', enemy)

  return state
}

describe('ranged archetype behavior (GAME-05)', () => {
  it('moves away from player when distance < KEEP_DISTANCE_INNER', () => {
    // Player at center, enemy inside keep-distance zone (KEEP_DISTANCE_INNER - 10,000 sub-units)
    const playerX = 2_000_000
    const playerY = 2_000_000
    const enemyX = playerX + KEEP_DISTANCE_INNER - 10_000 // 110,000 sub-units east (< KEEP_DISTANCE_INNER)
    const enemyY = 2_000_000

    const state = makeRangedState(playerX, playerY, enemyX, enemyY, 0)
    // Set to a tick that is NOT a fire tick so we only observe movement
    state.tick = 1 // tick 1 % 20 !== 0

    const inputs = new Map()
    const prng = mulberry32(1)
    const nextState = simulateTick(state, inputs, prng)

    const nextEnemy = nextState.enemies.get('ranged-1')!
    // Enemy should have moved EAST (away from player) — x should be > original enemyX
    expect(nextEnemy.x).toBeGreaterThan(enemyX)
  })

  it('fires isEnemy:true projectile at fire interval', () => {
    // Player at center, enemy 140,000 sub-units east (in fire band: 120k-160k)
    const playerX = 2_000_000
    const playerY = 2_000_000
    const enemyX = 2_140_000 // distance = 140,000 (between KEEP_DISTANCE_INNER and outer range)
    const enemyY = 2_000_000

    // lastFireTick = 0, advance to tick === ENEMY_FIRE_INTERVAL_TICKS (tick 20)
    const state = makeRangedState(playerX, playerY, enemyX, enemyY, 0)
    state.tick = ENEMY_FIRE_INTERVAL_TICKS // exactly at fire interval

    const inputs = new Map()
    const prng = mulberry32(1)
    const nextState = simulateTick(state, inputs, prng)

    expect(nextState.projectiles.size).toBeGreaterThanOrEqual(1)

    const hasEnemyProjectile = [...nextState.projectiles.values()].some((p) => p.isEnemy === true)
    expect(hasEnemyProjectile).toBe(true)
  })

  it('does NOT fire before interval elapses', () => {
    // Enemy just fired (lastFireTick = current tick)
    const playerX = 2_000_000
    const playerY = 2_000_000
    const enemyX = 2_140_000
    const enemyY = 2_000_000

    const state = makeRangedState(playerX, playerY, enemyX, enemyY, 10) // just fired at tick 10
    state.tick = 11 // only 1 tick elapsed since last fire (need 20)

    const inputs = new Map()
    const prng = mulberry32(1)
    const nextState = simulateTick(state, inputs, prng)

    // No enemy projectiles should exist
    const hasEnemyProjectile = [...nextState.projectiles.values()].some((p) => p.isEnemy === true)
    expect(hasEnemyProjectile).toBe(false)
  })
})
