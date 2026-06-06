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
 * Tick order (plan 03-06):
 *   1. Player movement
 *   2. applyEnemyAI (replaces inline placeholder from 03-02)
 *   3. spawnEnemies
 *   4. autoFire
 *   5. applyProjectileMovement
 *   6. applyCollisions
 *   7. applyEnemyContactDamage
 *   8. applyGemCollection
 *   9. applyLevelUp
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
import {
  autoFire,
  applyEnemyAI,
  applyProjectileMovement,
  applyCollisions,
  applyEnemyContactDamage,
  applyGemCollection,
  applyLevelUp,
} from './weapons.js'

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

  // 4. Enemy AI (replaces inline placeholder from plan 03-02 — do NOT run both)
  newState = applyEnemyAI(newState)

  // 5. Spawn enemies
  newState = spawnEnemies(newState, prng)

  // 6. Auto-fire player projectiles toward nearest enemy
  newState = autoFire(newState, prng)

  // 7. Move all projectiles
  newState = applyProjectileMovement(newState)

  // 8. Projectile collisions (player proj→enemy, enemy proj→player)
  newState = applyCollisions(newState)

  // 9. Enemy contact damage to players
  newState = applyEnemyContactDamage(newState)

  // 10. Gem collection (attract + snap-collect)
  newState = applyGemCollection(newState)

  // 11. Level-up check
  newState = applyLevelUp(newState)

  return newState
}
