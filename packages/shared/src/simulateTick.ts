/**
 * simulateTick — pure deterministic tick function (SC-2).
 *
 * Takes state + inputs + prng, returns NEW PlainGameState.
 * NEVER mutates input state. NEVER calls Math.random().
 * TICK_SEC is a compile-time constant — never use wall-clock delta.
 *
 * Player movement: 10,000 sub-units/tick at full speed (200 game-units/sec at 20Hz).
 * Diagonal speed normalized to [9900, 10100] sub-units via integer Math.round.
 * Toroidal world wrap: x = ((x % WORLD_W) + WORLD_W) % WORLD_W
 *
 * Enemy movement toward nearest player (toroidal) — will be replaced by
 * applyEnemyAI in plan 03-06 (see action note about double-movement risk).
 */
import type {
  PlainGameState,
  PlainPlayerState,
  PlainEnemyState,
  PlainGemState,
  PlainProjectileState,
} from './state.js'
import { PlayerInputSchema } from './schemas.js'
import type { PlayerInput } from './schemas.js'
import type { Prng } from './prng.js'
import { WORLD_W, WORLD_H } from './spatialGrid.js'
import { spawnEnemies } from './spawn.js'

export { WORLD_W, WORLD_H }
export const TICK_SEC = 1 / 20
export const SPEED_SUBUNITS = 10_000

/**
 * Deep-clone a PlainGameState without mutating the original.
 * Uses manual Map copying to handle the Map-based collections.
 */
function cloneState(state: PlainGameState): PlainGameState {
  const players = new Map<string, PlainPlayerState>()
  for (const [id, p] of state.players) {
    players.set(id, { ...p })
  }
  const enemies = new Map<string, PlainEnemyState>()
  for (const [id, e] of state.enemies) {
    enemies.set(id, { ...e })
  }
  const gems = new Map<string, PlainGemState>()
  for (const [id, g] of state.gems) {
    gems.set(id, { ...g })
  }
  const projectiles = new Map<string, PlainProjectileState>()
  for (const [id, pr] of state.projectiles) {
    projectiles.set(id, { ...pr })
  }
  return {
    tick: state.tick,
    elapsedMs: state.elapsedMs,
    players,
    enemies,
    gems,
    projectiles,
    prngSeed: state.prngSeed,
  }
}

/**
 * Toroidal wrap for a coordinate within [0, size).
 */
function toroidal(x: number, size: number): number {
  return ((x % size) + size) % size
}

/**
 * Compute toroidal distance component (shortest path on a torus).
 */
function toroidalDelta(a: number, b: number, size: number): number {
  let delta = b - a
  if (Math.abs(delta) > size / 2) {
    delta = delta > 0 ? delta - size : delta + size
  }
  return delta
}

/**
 * simulateTick(state, inputs, prng) — pure tick function.
 * Returns new state; never mutates input.
 */
export function simulateTick(
  state: PlainGameState,
  inputs: Map<string, PlayerInput>,
  prng: Prng
): PlainGameState {
  // 1. Deep-clone state — never mutate input (T-3-02)
  let newState = cloneState(state)

  // 2. Advance counters
  newState.tick = state.tick + 1
  newState.elapsedMs = state.elapsedMs + TICK_SEC * 1000

  // 3. Player movement
  for (const [playerId, player] of newState.players) {
    const rawInput = inputs.get(playerId)

    // Validate input via PlayerInputSchema (T-3-01)
    let input: PlayerInput | null = null
    if (rawInput !== undefined) {
      const parsed = PlayerInputSchema.safeParse(rawInput)
      if (parsed.success) {
        input = parsed.data
      }
    }

    if (input === null) continue

    const dx = input.moveVector.x
    const dy = input.moveVector.y

    // Skip if zero vector (no movement)
    if (dx === 0 && dy === 0) continue

    // Normalize to integer sub-unit displacement
    const mag = Math.sqrt(dx * dx + dy * dy)
    const vx = Math.round((dx * SPEED_SUBUNITS) / mag)
    const vy = Math.round((dy * SPEED_SUBUNITS) / mag)

    // Apply toroidal wrap
    player.x = toroidal(player.x + vx, WORLD_W)
    player.y = toroidal(player.y + vy, WORLD_H)

    newState.players.set(playerId, player)
  }

  // 4. Enemy movement toward nearest player (placeholder — replaced by applyEnemyAI in plan 03-06)
  // IMPORTANT: When wiring 03-06, REMOVE this entire block before adding applyEnemyAI.
  // Leaving both active causes double-movement (2x speed) bug.
  for (const [enemyId, enemy] of newState.enemies) {
    if (newState.players.size === 0) continue

    // Find nearest player using toroidal distance
    let nearestPlayer: PlainPlayerState | null = null
    let nearestDistSq = Infinity

    for (const player of newState.players.values()) {
      const adx = Math.abs(enemy.x - player.x)
      const ady = Math.abs(enemy.y - player.y)
      const tdx = adx > WORLD_W / 2 ? WORLD_W - adx : adx
      const tdy = ady > WORLD_H / 2 ? WORLD_H - ady : ady
      const distSq = tdx * tdx + tdy * tdy
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq
        nearestPlayer = player
      }
    }

    if (nearestPlayer === null) continue

    // Direction toward player (toroidal shortest path)
    const dx = toroidalDelta(enemy.x, nearestPlayer.x, WORLD_W)
    const dy = toroidalDelta(enemy.y, nearestPlayer.y, WORLD_H)
    const mag = Math.sqrt(dx * dx + dy * dy)

    if (mag === 0) continue

    const vx = Math.round((dx * enemy.speed) / mag)
    const vy = Math.round((dy * enemy.speed) / mag)

    enemy.x = toroidal(enemy.x + vx, WORLD_W)
    enemy.y = toroidal(enemy.y + vy, WORLD_H)

    newState.enemies.set(enemyId, enemy)
  }

  // 5. Spawn enemies
  newState = spawnEnemies(newState, prng)

  return newState
}
