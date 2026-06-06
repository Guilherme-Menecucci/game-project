/**
 * weapons.ts — combat layer for the shared game simulation (GAME-03, GAME-05, GAME-06, GAME-07).
 *
 * Pure functions — all take PlainGameState, return NEW PlainGameState.
 * NEVER mutate input state. NEVER call Math.random().
 *
 * Functions:
 *   autoFire         — player fires toward nearest enemy every AUTO_FIRE_INTERVAL_TICKS
 *   applyEnemyAI     — swarmer/tank chase; ranged keep-distance + periodic fire (GAME-05)
 *   applyProjectileMovement — move all projectiles, apply toroidal wrap, expire by lifetime
 *   applyCollisions  — UniformGrid broadphase; player proj→enemy; enemy proj→player
 *   applyEnemyContactDamage — enemy overlapping player reduces player HP
 *   applyGemCollection — gems attract toward player; snap-collect awards XP
 *   applyLevelUp     — player levels up when xp >= XP_LEVEL_THRESHOLD
 *
 * Threat model:
 *   T-3-02: XP/level incremented only here, never from client message
 *   T-3-05: HP decremented only here, server-side
 *   T-3-06: Enemy projectiles created only when archetype==='ranged' + fire interval
 */

import type { PlainGameState, PlainPlayerState, PlainEnemyState } from './state.js'
import { UniformGrid, WORLD_W, WORLD_H } from './spatialGrid.js'
import type { Prng } from './prng.js'
import { XP_PER_ARCHETYPE } from './spawn.js'

// ─── Constants ────────────────────────────────────────────────────────────────

export const PLAYER_PROJECTILE_SPEED = 20_000 // sub-units/tick (400 game-units/sec at 20Hz)
export const ENEMY_PROJECTILE_SPEED = 12_000 // sub-units/tick (240 game-units/sec at 20Hz)
export const ENEMY_PROJECTILE_DAMAGE = 2 // ranged hit hurts more than contact
export const PROJECTILE_DAMAGE = 1 // player projectile damage
export const AUTO_FIRE_INTERVAL_TICKS = 20 // 1 fire/sec at 20Hz
export const ENEMY_FIRE_INTERVAL_TICKS = 20 // ranged fires every 1 second
export const GEM_COLLECT_RADIUS = 80_000 // sub-units — begin attracting within this range
export const GEM_COLLECT_SNAP = 10_000 // sub-units — collect (award XP) within snap radius
export const GEM_SPEED = 10_000 // sub-units/tick toward player
export const XP_LEVEL_THRESHOLD = 10 // XP needed to level up
export const ENEMY_CONTACT_DAMAGE = 1 // HP per tick while overlapping enemy
export const ENEMY_CONTACT_RADIUS = 20_000 // sub-units — player hitbox for contact damage
export const RANGED_SPEED = 8_000 // sub-units/tick for ranged approach/retreat
export const KEEP_DISTANCE_INNER = 120_000 // sub-units — move away if closer than this
export const KEEP_DISTANCE_OUTER = 160_000 // sub-units — move toward if farther than this
export const PLAYER_PROJECTILE_LIFETIME = 100 // ticks (5 seconds at 20Hz)
export const ENEMY_PROJECTILE_LIFETIME = 60 // ticks (3 seconds at 20Hz)
export const PROJECTILE_HIT_RADIUS = 8_000 // sub-units for collision detection

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Toroidal wrap for a coordinate within [0, size).
 */
function toroidal(x: number, size: number): number {
  return ((x % size) + size) % size
}

/**
 * Compute toroidal delta (shortest path on a torus): b - a, adjusted for wrap.
 */
function toroidalDelta(a: number, b: number, size: number): number {
  let delta = b - a
  if (Math.abs(delta) > size / 2) {
    delta = delta > 0 ? delta - size : delta + size
  }
  return delta
}

/**
 * Compute toroidal squared distance between two points.
 */
function toroidalDistSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = toroidalDelta(ax, bx, WORLD_W)
  const dy = toroidalDelta(ay, by, WORLD_H)
  return dx * dx + dy * dy
}

/**
 * Find the nearest player to a position using toroidal distance.
 * Returns null if no players.
 */
function nearestPlayer(
  x: number,
  y: number,
  players: Map<string, PlainPlayerState>
): PlainPlayerState | null {
  let nearest: PlainPlayerState | null = null
  let nearestDistSq = Infinity
  for (const player of players.values()) {
    const distSq = toroidalDistSq(x, y, player.x, player.y)
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq
      nearest = player
    }
  }
  return nearest
}

// ─── autoFire ─────────────────────────────────────────────────────────────────

/**
 * autoFire(state, prng) — fires player projectiles toward nearest enemy.
 * Fires only on ticks where (state.tick % AUTO_FIRE_INTERVAL_TICKS) === 0.
 * If no enemy, fires at random direction (prng-based for determinism).
 */
export function autoFire(state: PlainGameState, prng: Prng): PlainGameState {
  if (state.tick % AUTO_FIRE_INTERVAL_TICKS !== 0) {
    return state
  }

  const newProjectiles = new Map(state.projectiles)
  let changed = false

  for (const [playerId, player] of state.players) {
    // Find nearest enemy
    let nearestEnemy: PlainEnemyState | null = null
    let nearestDistSq = Infinity
    for (const enemy of state.enemies.values()) {
      const distSq = toroidalDistSq(player.x, player.y, enemy.x, enemy.y)
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq
        nearestEnemy = enemy
      }
    }

    let angle: number
    if (nearestEnemy !== null) {
      const dx = toroidalDelta(player.x, nearestEnemy.x, WORLD_W)
      const dy = toroidalDelta(player.y, nearestEnemy.y, WORLD_H)
      angle = Math.atan2(dy, dx)
    } else {
      // No enemy — fire at random direction (prng-based)
      angle = prng.next() * 2 * Math.PI
    }

    const vx = Math.round(Math.cos(angle) * PLAYER_PROJECTILE_SPEED)
    const vy = Math.round(Math.sin(angle) * PLAYER_PROJECTILE_SPEED)

    const projId = `proj_${state.tick}_${playerId}`
    newProjectiles.set(projId, {
      id: projId,
      x: player.x,
      y: player.y,
      vx,
      vy,
      ownerId: playerId,
      isEnemy: false,
      damage: PROJECTILE_DAMAGE,
      lifetime: PLAYER_PROJECTILE_LIFETIME,
    })
    changed = true
  }

  if (!changed) return state
  return { ...state, projectiles: newProjectiles }
}

// ─── applyEnemyAI ─────────────────────────────────────────────────────────────

/**
 * applyEnemyAI(state) — per-enemy AI update.
 *
 * Swarmer/Tank: move toward nearest player at enemy.speed sub-units/tick.
 *
 * Ranged (GAME-05):
 *   - distance < KEEP_DISTANCE_INNER: move away at RANGED_SPEED
 *   - distance > KEEP_DISTANCE_OUTER: move toward at RANGED_SPEED
 *   - else: hold position (fire band)
 *   In all cases: if (state.tick - enemy.lastFireTick) >= ENEMY_FIRE_INTERVAL_TICKS, fire.
 *
 * This function REPLACES the inline enemy movement block in simulateTick.ts (plan 03-02 placeholder).
 */
export function applyEnemyAI(state: PlainGameState): PlainGameState {
  if (state.enemies.size === 0 || state.players.size === 0) {
    return state
  }

  const newEnemies = new Map<string, PlainEnemyState>()
  const newProjectiles = new Map(state.projectiles)
  let projChanged = false

  for (const [enemyId, enemy] of state.enemies) {
    const player = nearestPlayer(enemy.x, enemy.y, state.players)
    if (player === null) {
      newEnemies.set(enemyId, { ...enemy })
      continue
    }

    const dx = toroidalDelta(enemy.x, player.x, WORLD_W)
    const dy = toroidalDelta(enemy.y, player.y, WORLD_H)
    const dist = Math.sqrt(dx * dx + dy * dy)

    const updatedEnemy = { ...enemy }

    if (dist === 0) {
      // Enemy is on top of player — no movement
      newEnemies.set(enemyId, updatedEnemy)
      continue
    }

    const nx = dx / dist
    const ny = dy / dist

    if (enemy.archetype === 'swarmer' || enemy.archetype === 'tank') {
      // Move toward player at enemy.speed
      updatedEnemy.x = toroidal(enemy.x + Math.round(nx * enemy.speed), WORLD_W)
      updatedEnemy.y = toroidal(enemy.y + Math.round(ny * enemy.speed), WORLD_H)
    } else if (enemy.archetype === 'ranged') {
      // Ranged: keep-distance movement
      if (dist < KEEP_DISTANCE_INNER) {
        // Too close — move away at RANGED_SPEED
        updatedEnemy.x = toroidal(enemy.x + Math.round(-nx * RANGED_SPEED), WORLD_W)
        updatedEnemy.y = toroidal(enemy.y + Math.round(-ny * RANGED_SPEED), WORLD_H)
      } else if (dist > KEEP_DISTANCE_OUTER) {
        // Too far — move toward at RANGED_SPEED
        updatedEnemy.x = toroidal(enemy.x + Math.round(nx * RANGED_SPEED), WORLD_W)
        updatedEnemy.y = toroidal(enemy.y + Math.round(ny * RANGED_SPEED), WORLD_H)
      }
      // else: in fire band — hold position

      // Fire check: elapsed-based (not modulo)
      if (state.tick - enemy.lastFireTick >= ENEMY_FIRE_INTERVAL_TICKS) {
        // Fire toward player — use toroidal dx/dy direction toward player
        const fireAngle = Math.atan2(dy, dx)
        const ex_vx = Math.round(Math.cos(fireAngle) * ENEMY_PROJECTILE_SPEED)
        const ex_vy = Math.round(Math.sin(fireAngle) * ENEMY_PROJECTILE_SPEED)

        const projId = `eproj_${state.tick}_${enemyId}`
        newProjectiles.set(projId, {
          id: projId,
          x: enemy.x,
          y: enemy.y,
          vx: ex_vx,
          vy: ex_vy,
          ownerId: enemyId,
          isEnemy: true,
          damage: ENEMY_PROJECTILE_DAMAGE,
          lifetime: ENEMY_PROJECTILE_LIFETIME,
        })
        projChanged = true
        updatedEnemy.lastFireTick = state.tick
      }
    }

    newEnemies.set(enemyId, updatedEnemy)
  }

  const result: PlainGameState = { ...state, enemies: newEnemies }
  if (projChanged) {
    result.projectiles = newProjectiles
  }
  return result
}

// ─── applyProjectileMovement ──────────────────────────────────────────────────

/**
 * applyProjectileMovement(state) — advance all projectiles by their velocity.
 * Applies toroidal wrap. Decrements lifetime. Removes expired projectiles (lifetime <= 0).
 */
export function applyProjectileMovement(state: PlainGameState): PlainGameState {
  if (state.projectiles.size === 0) return state

  const newProjectiles = new Map(state.projectiles)

  for (const [id, proj] of newProjectiles) {
    const newLifetime = proj.lifetime - 1
    if (newLifetime <= 0) {
      newProjectiles.delete(id)
      continue
    }
    newProjectiles.set(id, {
      ...proj,
      x: toroidal(proj.x + proj.vx, WORLD_W),
      y: toroidal(proj.y + proj.vy, WORLD_H),
      lifetime: newLifetime,
    })
  }

  return { ...state, projectiles: newProjectiles }
}

// ─── applyCollisions ──────────────────────────────────────────────────────────

/**
 * applyCollisions(state) — UniformGrid-based O(n) collision detection.
 *
 * Pass 1: Player projectiles (isEnemy===false) vs enemies.
 *   Hit → decrement enemy.hp; if hp <= 0: remove enemy, drop gem.
 *   Remove projectile on first hit.
 *
 * Pass 2: Enemy projectiles (isEnemy===true) vs players.
 *   Hit → player.hp = max(0, player.hp - damage); remove projectile.
 *
 * T-3-05 mitigation: HP decremented server-side only from authoritative state.
 */
export function applyCollisions(state: PlainGameState): PlainGameState {
  const newEnemies = new Map(state.enemies)
  const newPlayers = new Map(state.players)
  const newProjectiles = new Map(state.projectiles)
  const newGems = new Map(state.gems)
  let changed = false

  // ── Pass 1: Player projectiles vs enemies ──
  if (state.enemies.size > 0) {
    const enemyGrid = new UniformGrid()
    for (const [id, enemy] of newEnemies) {
      enemyGrid.insert(id, enemy.x, enemy.y)
    }

    for (const [projId, proj] of state.projectiles) {
      if (proj.isEnemy) continue // skip enemy projectiles
      if (!newProjectiles.has(projId)) continue // already consumed

      const hits = enemyGrid.queryRadius(proj.x, proj.y, PROJECTILE_HIT_RADIUS)
      for (const enemyId of hits) {
        const enemy = newEnemies.get(enemyId)
        if (enemy === undefined) continue // already dead from prior projectile this tick

        const updatedHp = enemy.hp - proj.damage
        if (updatedHp <= 0) {
          // Enemy dead: drop gem at death position
          newEnemies.delete(enemyId)
          const gemId = `gem_${state.tick}_${enemyId}`
          const xpValue = XP_PER_ARCHETYPE[enemy.archetype]
          newGems.set(gemId, {
            id: gemId,
            x: enemy.x,
            y: enemy.y,
            value: xpValue,
          })
        } else {
          newEnemies.set(enemyId, { ...enemy, hp: updatedHp })
        }

        // Remove the projectile after its first hit
        newProjectiles.delete(projId)
        changed = true
        break // one projectile hits one enemy
      }
    }
  }

  // ── Pass 2: Enemy projectiles vs players ──
  if (state.players.size > 0) {
    const playerGrid = new UniformGrid()
    for (const [id, player] of newPlayers) {
      playerGrid.insert(id, player.x, player.y)
    }

    for (const [projId, proj] of state.projectiles) {
      if (!proj.isEnemy) continue // skip player projectiles
      if (!newProjectiles.has(projId)) continue // already consumed

      const hits = playerGrid.queryRadius(proj.x, proj.y, PROJECTILE_HIT_RADIUS)
      for (const playerId of hits) {
        const player = newPlayers.get(playerId)
        if (player === undefined) continue

        const updatedHp = Math.max(0, player.hp - proj.damage)
        newPlayers.set(playerId, { ...player, hp: updatedHp })

        // Remove the enemy projectile after hit
        newProjectiles.delete(projId)
        changed = true
        break // one projectile hits one player
      }
    }
  }

  if (!changed && newEnemies.size === state.enemies.size && newGems.size === state.gems.size) {
    return state
  }
  return {
    ...state,
    enemies: newEnemies,
    players: newPlayers,
    projectiles: newProjectiles,
    gems: newGems,
  }
}

// ─── applyEnemyContactDamage ──────────────────────────────────────────────────

/**
 * applyEnemyContactDamage(state) — deal ENEMY_CONTACT_DAMAGE to players overlapping enemies.
 * Uses UniformGrid for O(n) broadphase.
 * HP clamped to >= 0 (T-3-05 mitigation).
 */
export function applyEnemyContactDamage(state: PlainGameState): PlainGameState {
  if (state.enemies.size === 0 || state.players.size === 0) return state

  const playerGrid = new UniformGrid()
  for (const [id, player] of state.players) {
    playerGrid.insert(id, player.x, player.y)
  }

  const newPlayers = new Map(state.players)
  let changed = false

  for (const enemy of state.enemies.values()) {
    const hits = playerGrid.queryRadius(enemy.x, enemy.y, ENEMY_CONTACT_RADIUS)
    for (const playerId of hits) {
      const player = newPlayers.get(playerId)
      if (player === undefined) continue
      const updatedHp = Math.max(0, player.hp - ENEMY_CONTACT_DAMAGE)
      if (updatedHp !== player.hp) {
        newPlayers.set(playerId, { ...player, hp: updatedHp })
        changed = true
      }
    }
  }

  if (!changed) return state
  return { ...state, players: newPlayers }
}

// ─── applyGemCollection ───────────────────────────────────────────────────────

/**
 * applyGemCollection(state) — gems attract toward nearest player within GEM_COLLECT_RADIUS.
 * When distance < GEM_COLLECT_SNAP, gem is collected: removed, player.xp += gem.value.
 */
export function applyGemCollection(state: PlainGameState): PlainGameState {
  if (state.gems.size === 0 || state.players.size === 0) return state

  const newGems = new Map(state.gems)
  const newPlayers = new Map(state.players)
  let changed = false

  for (const [gemId, gem] of state.gems) {
    // Find nearest player
    const player = nearestPlayer(gem.x, gem.y, state.players)
    if (player === null) continue

    const dx = toroidalDelta(gem.x, player.x, WORLD_W)
    const dy = toroidalDelta(gem.y, player.y, WORLD_H)
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < GEM_COLLECT_SNAP) {
      // Collect gem — award XP to player
      newGems.delete(gemId)
      const currentPlayer = newPlayers.get(player.id) ?? player
      newPlayers.set(player.id, { ...currentPlayer, xp: currentPlayer.xp + gem.value })
      changed = true
    } else if (dist < GEM_COLLECT_RADIUS) {
      // Attract toward player at GEM_SPEED
      const nx = dx / dist
      const ny = dy / dist
      const newGem = {
        ...gem,
        x: toroidal(gem.x + Math.round(nx * GEM_SPEED), WORLD_W),
        y: toroidal(gem.y + Math.round(ny * GEM_SPEED), WORLD_H),
      }
      newGems.set(gemId, newGem)
      changed = true
    }
  }

  if (!changed) return state
  return { ...state, gems: newGems, players: newPlayers }
}

// ─── applyLevelUp ─────────────────────────────────────────────────────────────

/**
 * applyLevelUp(state) — level up players that have reached XP_LEVEL_THRESHOLD.
 * Repeating: while xp >= threshold, level++, xp -= threshold.
 * T-3-02 mitigation: level only incremented here, never from client message.
 */
export function applyLevelUp(state: PlainGameState): PlainGameState {
  let changed = false
  const newPlayers = new Map(state.players)

  for (const [playerId, player] of state.players) {
    if (player.xp >= XP_LEVEL_THRESHOLD) {
      let { xp, level } = player
      while (xp >= XP_LEVEL_THRESHOLD) {
        xp -= XP_LEVEL_THRESHOLD
        level++
      }
      newPlayers.set(playerId, { ...player, xp, level })
      changed = true
    }
  }

  if (!changed) return state
  return { ...state, players: newPlayers }
}
