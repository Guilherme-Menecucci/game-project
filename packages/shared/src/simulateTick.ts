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
 * Tick order (plan 05-06 — 14 steps):
 *   1.  Player movement
 *   2.  applyEnemyAI (replaces inline placeholder from 03-02)
 *   3.  spawnEnemies (regular wave spawning)
 *   4.  checkMilestoneSpawns (milestone elites/bosses, alongside spawnEnemies for
 *       spatial/temporal consistency — no-op until elapsedMs crosses a threshold)
 *   5.  autoFire (player projectile creation)
 *   6.  applyProjectileMovement (move all projectiles)
 *   7.  applyCollisions (player proj→enemy, enemy proj→player, boss hits)
 *   8.  applyEnemyContactDamage (enemy overlap → player HP)
 *   9.  applyBossAI (boss movement + D-19 telegraph/attack state machine — no-op
 *       while bosses is empty; called after contact damage so boss attack this tick
 *       is visible before defeat detection runs)
 *   10. applyGemCollection (attract + snap-collect)
 *   11. applyPickupCollection (proximity collection)
 *   12. applyLevelUp (XP threshold check)
 *   13. Defeat detection: if any player.hp <= 0 and result !== 'defeated',
 *       set result='defeated'. Does NOT halt the pipeline — endless mode (GAME-15)
 *       keeps ticking; SoloRoom (plan 05-07) decides what to do with the flag.
 *       'survived' is set exclusively by SoloRoom on disconnect, never here.
 */
import type {
  PlainGameState,
  PlainPlayerState,
  PlainEnemyState,
  PlainGemState,
  PlainProjectileState,
  PlainPickupState,
  PlainBossState,
} from './state.js'
import { PlayerInputSchema } from './schemas.js'
import type { PlayerInput } from './schemas.js'
import type { Prng } from './prng.js'
import { WORLD_W, WORLD_H } from './spatialGrid.js'
import { spawnEnemies } from './spawn.js'
import { checkMilestoneSpawns } from './runMilestones.js'
import {
  autoFire,
  applyEnemyAI,
  applyBossAI,
  applyProjectileMovement,
  applyCollisions,
  applyEnemyContactDamage,
  applyGemCollection,
  applyLevelUp,
  applyPickupCollection,
} from './weapons.js'

export { WORLD_W, WORLD_H }
export const TICK_SEC = 1 / 20
export const SPEED_SUBUNITS = 10_000

/**
 * Deep-clone a PlainGameState without mutating the original.
 * Uses manual Map copying to handle the Map-based collections.
 */
export function cloneState(state: PlainGameState): PlainGameState {
  const players = new Map<string, PlainPlayerState>()
  for (const [id, p] of state.players) {
    players.set(id, {
      ...p,
      weapons: [...p.weapons],
      passives: [...p.passives],
      // Deep per-slot clone — mutating a clone's weaponStats entry must never
      // affect the original (D-21, Pitfall 3).
      weaponStats: Object.fromEntries(
        Object.entries(p.weaponStats ?? {}).map(([k, v]) => [k, { ...v }])
      ),
    })
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
  const pickups = new Map<string, PlainPickupState>()
  for (const [id, pk] of state.pickups) {
    pickups.set(id, { ...pk })
  }
  // Boss entities have no nested objects/arrays — shallow per-entry clone is sufficient.
  const bosses = new Map<string, PlainBossState>()
  for (const [id, b] of state.bosses ?? new Map<string, PlainBossState>()) {
    bosses.set(id, { ...b })
  }
  return {
    tick: state.tick,
    elapsedMs: state.elapsedMs,
    players,
    enemies,
    gems,
    projectiles,
    pickups,
    prngSeed: state.prngSeed,
    kills: state.kills ?? 0,
    bosses,
    milestonesSpawned: { ...(state.milestonesSpawned ?? {}) },
    result: state.result,
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
  // Clone state and advance counters (pre-step — never mutate input, T-3-02)
  let newState = cloneState(state)
  newState.tick = state.tick + 1
  newState.elapsedMs = state.elapsedMs + TICK_SEC * 1000

  // Step 1. Player movement
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
    const speed = player.speed ?? SPEED_SUBUNITS
    const vx = Math.round((dx * speed) / mag)
    const vy = Math.round((dy * speed) / mag)

    // Apply toroidal wrap
    player.x = toroidal(player.x + vx, WORLD_W)
    player.y = toroidal(player.y + vy, WORLD_H)

    newState.players.set(playerId, player)
  }

  // Step 2. Enemy AI (replaces inline placeholder from plan 03-02 — do NOT run both)
  newState = applyEnemyAI(newState)

  // Step 3. Spawn regular wave enemies
  newState = spawnEnemies(newState, prng)

  // Step 4. Milestone elite/boss spawns (alongside spawnEnemies — no-op until
  //    elapsedMs crosses a MILESTONE_MS threshold not yet in milestonesSpawned).
  //    Called unconditionally every tick at this fixed position for determinism.
  newState = checkMilestoneSpawns(newState, prng)

  // Step 5. Auto-fire player projectiles toward nearest enemy
  newState = autoFire(newState, inputs, prng)

  // Step 6. Move all projectiles
  newState = applyProjectileMovement(newState)

  // Step 7. Projectile collisions (player proj→enemy, enemy proj→player, boss hits)
  newState = applyCollisions(newState, prng)

  // Step 8. Enemy contact damage to players
  newState = applyEnemyContactDamage(newState)

  // Step 9. Boss AI: movement + D-19 telegraph/attack state machine.
  //    No-op while state.bosses is empty. Called after contact damage so
  //    boss attack this tick is visible before defeat detection (step 13).
  //    Note: applyBossAI takes only state (no prng) — fully deterministic.
  newState = applyBossAI(newState)

  // Step 10. Gem collection (attract + snap-collect)
  newState = applyGemCollection(newState)

  // Step 11. Pickup collection (proximity collection)
  newState = applyPickupCollection(newState)

  // Step 12. Level-up check
  newState = applyLevelUp(newState)

  // Step 13. Defeat detection — set result='defeated' the tick any player's hp drops
  //     to 0. Does NOT halt the pipeline (GAME-15 endless mode). Never sets
  //     'survived' — that is set exclusively by SoloRoom on disconnect (05-07).
  if (newState.result !== 'defeated') {
    for (const player of newState.players.values()) {
      if (player.hp <= 0) {
        newState.result = 'defeated'
        break
      }
    }
  }

  return newState
}
