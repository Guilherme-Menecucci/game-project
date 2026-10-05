/**
 * spawnEnemies — applies spawn curve logic and adds enemies to state.
 *
 * Spawn interval: max(300, 2000 - elapsedMs * 0.02) / SPAWN_RATE_MULT[n]
 * Max alive: min(300, 20 + floor(elapsedMs/5000) * 10)
 * Archetype mix:
 *   0-60s: 100% swarmer
 *   60-120s: 70% swarmer / 20% tank / 10% ranged
 *   120s+: 50% swarmer / 30% tank / 20% ranged
 *
 * Co-op difficulty scaling (Phase 6, ROOM-10) — gated on state.mode === 'coop'
 * and driven ONLY by state.playerCount (frozen at run start, OQ2; never
 * room.clients):
 *   - spawn rate x1.0 / x1.6 / x2.2 / x2.8 for 1-4 players (interval divided)
 *   - enemy HP +20% per extra player, rounded at spawn time
 *   - spawn anchor: ONE extra prng draw selects a non-eliminated player
 * Solo performs no new prng draw, so its sequence is byte-identical to
 * Phase 5 (Pitfall 2).
 *
 * CRITICAL: NEVER call Math.random() — use the prng parameter only.
 */
import type {
  PlainGameState,
  PlainEnemyState,
  PlainPickupState,
  PlainPlayerState,
} from './state.js'
import type { Prng } from './prng.js'
import { WORLD_W, WORLD_H } from './spatialGrid.js'

export const BASE_SPAWN_INTERVAL_MS = 2000
export const MIN_SPAWN_INTERVAL_MS = 300
export const BASE_MAX_ENEMIES = 20
export const MAX_ENEMIES_CAP = 300
// Phase 6 (ROOM-10): spawn-rate multiplier indexed by playerCount (index 0
// unused). Higher rates only reach MAX_ENEMIES_CAP faster — the cap is fixed.
export const SPAWN_RATE_MULT: readonly number[] = [1.0, 1.0, 1.6, 2.2, 2.8]
export const MAX_COOP_PLAYERS = 4

// Tick duration in ms (must match simulateTick TICK_SEC * 1000)
const TICK_MS = 50 // 1/20 * 1000

export const XP_PER_ARCHETYPE: Record<'swarmer' | 'tank' | 'ranged', number> = {
  swarmer: 1,
  tank: 3,
  ranged: 2,
}

/** Clamp a player count into the supported 1..MAX_COOP_PLAYERS range. */
function clampPlayerCount(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.min(MAX_COOP_PLAYERS, Math.max(1, Math.floor(n)))
}

/**
 * The player count difficulty scales by. Solo (or any non-coop mode) is
 * always 1 regardless of state.playerCount — the mode gate keeps solo
 * byte-identical to Phase 5. Coop reads the frozen state.playerCount snapshot
 * (default 1), clamped to 1..4 so a bad value can never index SPAWN_RATE_MULT
 * out of range (a NaN interval would silently stop spawning).
 */
export function difficultyPlayerCount(state: PlainGameState): number {
  if (state.mode !== 'coop') return 1
  return clampPlayerCount(state.playerCount ?? 1)
}

/** Enemy/elite HP at spawn: +20% per extra player, rounded. n=1 is identity. */
export function scaleEnemyHp(baseHp: number, playerCount: number): number {
  return Math.round(baseHp * (1 + 0.2 * (playerCount - 1)))
}

/**
 * Compute spawn interval in ms based on elapsed time and player count.
 * The Phase 5 solo interval (300ms floor applied first) divided by
 * SPAWN_RATE_MULT[playerCount]; playerCount 1 returns the Phase 5 value exactly.
 */
export function spawnIntervalMs(elapsedMs: number, playerCount = 1): number {
  const solo = Math.max(MIN_SPAWN_INTERVAL_MS, BASE_SPAWN_INTERVAL_MS - elapsedMs * 0.02)
  return solo / SPAWN_RATE_MULT[clampPlayerCount(playerCount)]!
}

/**
 * Select the player a spawn is positioned relative to.
 *
 * - No players → undefined (caller falls back to world center; no draw).
 * - Non-coop → first player, ZERO prng draws (Phase 5 behaviour, Pitfall 2).
 * - Coop → exactly ONE prng draw, unconditionally (so the draw count depends
 *   only on mode), indexing the non-eliminated players in insertion order.
 *   Downed players may anchor; eliminated players never do. If every player
 *   is eliminated the draw is still consumed and the first player is used
 *   (deterministic fallback — the run is already defeated at that point).
 */
export function pickSpawnAnchor(state: PlainGameState, prng: Prng): PlainPlayerState | undefined {
  if (state.players.size === 0) return undefined
  const players = [...state.players.values()]
  if (state.mode !== 'coop') return players[0]
  const roll = prng.next()
  const eligible = players.filter((p) => !p.eliminated)
  if (eligible.length === 0) return players[0]
  return eligible[Math.min(eligible.length - 1, Math.floor(roll * eligible.length))]
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
  const playerCount = difficultyPlayerCount(state)
  const intervalMs = spawnIntervalMs(state.elapsedMs, playerCount)
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
  // Phase 6 (ROOM-10): HP scaled at spawn time (identity for solo / n=1).
  const hp = scaleEnemyHp(stats.hp, playerCount)
  const maxHp = scaleEnemyHp(stats.maxHp, playerCount)

  // Determine spawn position: 600,000 sub-units from an anchor player.
  // Draw order: archetype → anchor (coop only) → angle.
  let spawnX: number
  let spawnY: number

  const player = pickSpawnAnchor(state, prng)
  if (player) {
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
    hp,
    maxHp,
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
