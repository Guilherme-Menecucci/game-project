/**
 * spawnEnemies — applies spawn curve logic and adds enemies to state.
 *
 * Spawn interval: max(300, 2000 - elapsedMs * 0.02)
 * Max alive: min(300, 20 + floor(elapsedMs/5000) * 10)
 * Archetype mix:
 *   0-60s: 100% swarmer
 *   60-120s: 70% swarmer / 20% tank / 10% ranged
 *   120s+: 50% swarmer / 30% tank / 20% ranged
 *
 * CRITICAL: NEVER call Math.random() — use the prng parameter only.
 */
import type { PlainGameState, PlainEnemyState, PlainPickupState } from './state.js'
import type { Prng } from './prng.js'
import { WORLD_W, WORLD_H } from './spatialGrid.js'

export const BASE_SPAWN_INTERVAL_MS = 2000
export const MIN_SPAWN_INTERVAL_MS = 300
export const BASE_MAX_ENEMIES = 20
export const MAX_ENEMIES_CAP = 300

// Tick duration in ms (must match simulateTick TICK_SEC * 1000)
const TICK_MS = 50 // 1/20 * 1000

export const XP_PER_ARCHETYPE: Record<'swarmer' | 'tank' | 'ranged', number> = {
  swarmer: 1,
  tank: 3,
  ranged: 2,
}

/**
 * Compute spawn interval in ms based on elapsed time.
 */
function spawnIntervalMs(elapsedMs: number): number {
  return Math.max(MIN_SPAWN_INTERVAL_MS, BASE_SPAWN_INTERVAL_MS - elapsedMs * 0.02)
}

/**
 * Pick enemy archetype based on elapsed time and PRNG roll.
 */
function pickArchetype(elapsedMs: number, prng: Prng): 'swarmer' | 'tank' | 'ranged' {
  const roll = prng.next()

  if (elapsedMs <= 60_000) {
    // 0-60s: swarmers only
    return 'swarmer'
  } else if (elapsedMs <= 120_000) {
    // 60-120s: 70% swarmer / 20% tank / 10% ranged
    if (roll < 0.7) return 'swarmer'
    if (roll < 0.9) return 'tank'
    return 'ranged'
  } else {
    // 120s+: 50% swarmer / 30% tank / 20% ranged
    if (roll < 0.5) return 'swarmer'
    if (roll < 0.8) return 'tank'
    return 'ranged'
  }
}

/**
 * Get stats for the given archetype.
 * Speeds are sub-units per tick (at 20Hz).
 */
function archetypeStats(archetype: 'swarmer' | 'tank' | 'ranged'): {
  hp: number
  maxHp: number
  speed: number
} {
  switch (archetype) {
    case 'swarmer':
      return { hp: 1, maxHp: 1, speed: 7_500 }
    case 'tank':
      return { hp: 10, maxHp: 10, speed: 3_000 }
    case 'ranged':
      return { hp: 3, maxHp: 3, speed: 4_500 }
  }
}

/**
 * spawnEnemies(state, prng) — returns new state with enemies possibly added.
 * Does not mutate input state.
 */
export function spawnEnemies(state: PlainGameState, prng: Prng): PlainGameState {
  const intervalMs = spawnIntervalMs(state.elapsedMs)
  const ticksPerSpawn = Math.round(intervalMs / TICK_MS)

  // Only spawn on the right tick boundary
  if (state.tick % ticksPerSpawn !== 0) {
    return state
  }

  // Check max-alive cap
  const maxAlive = Math.min(
    MAX_ENEMIES_CAP,
    BASE_MAX_ENEMIES + Math.floor(state.elapsedMs / 5000) * 10
  )
  if (state.enemies.size >= maxAlive) {
    return state
  }

  // Pick archetype (advances prng)
  const archetype = pickArchetype(state.elapsedMs, prng)
  const stats = archetypeStats(archetype)

  // Determine spawn position: 600,000 sub-units from a random player
  let spawnX: number
  let spawnY: number

  if (state.players.size > 0) {
    // Pick first player (deterministic — no random player selection needed)
    const players = [...state.players.values()]
    const player = players[0]!
    const angle = prng.next() * 2 * Math.PI
    const dx = Math.round(Math.cos(angle) * 600_000)
    const dy = Math.round(Math.sin(angle) * 600_000)
    spawnX = (((player.x + dx) % WORLD_W) + WORLD_W) % WORLD_W
    spawnY = (((player.y + dy) % WORLD_H) + WORLD_H) % WORLD_H
  } else {
    const angle = prng.next() * 2 * Math.PI
    spawnX =
      (((Math.floor(WORLD_W / 2) + Math.round(Math.cos(angle) * 600_000)) % WORLD_W) + WORLD_W) %
      WORLD_W
    spawnY =
      (((Math.floor(WORLD_H / 2) + Math.round(Math.sin(angle) * 600_000)) % WORLD_H) + WORLD_H) %
      WORLD_H
  }

  // Build new enemy
  const id = `e${state.tick}_${state.enemies.size}`
  const enemy: PlainEnemyState = {
    id,
    x: spawnX,
    y: spawnY,
    hp: stats.hp,
    maxHp: stats.maxHp,
    archetype,
    speed: stats.speed,
    lastFireTick: 0,
  }

  // Return new state with enemy added (do not mutate input)
  const newEnemies = new Map(state.enemies)
  newEnemies.set(id, enemy)

  return {
    ...state,
    enemies: newEnemies,
  }
}

/**
 * rollPickupDrop — rolls a random pickup drop when an enemy dies.
 * Deterministic PRNG draw order: drop check -> kind select -> id generation.
 */
export function rollPickupDrop(
  enemyArchetype: 'swarmer' | 'tank' | 'ranged',
  xOrPrng: number | Prng,
  y?: number,
  prng?: Prng
): PlainPickupState | null {
  let activePrng: Prng
  let activeX = 0
  let activeY = 0

  if (typeof xOrPrng === 'number') {
    activeX = xOrPrng
    activeY = y ?? 0
    activePrng = prng!
  } else {
    activePrng = xOrPrng
  }

  const roll = activePrng.next()
  let threshold = 0

  switch (enemyArchetype) {
    case 'swarmer':
      threshold = 0.02
      break
    case 'tank':
      threshold = 0.08
      break
    case 'ranged':
      threshold = 0.05
      break
  }

  if (roll < threshold) {
    const kindRoll = activePrng.next()
    let kind: 'health_orb' | 'xp_magnet' | 'screen_bomb'
    if (kindRoll < 0.333) {
      kind = 'health_orb'
    } else if (kindRoll < 0.667) {
      kind = 'xp_magnet'
    } else {
      kind = 'screen_bomb'
    }

    const prngDraw = activePrng.next()
    const id = `pk-${activeX}-${activeY}-${prngDraw.toString(36).slice(2)}`
    return { id, x: activeX, y: activeY, kind }
  }

  return null
}
