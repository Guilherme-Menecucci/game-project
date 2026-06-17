/**
 * weapons.ts — combat layer for the shared game simulation (GAME-03, GAME-05, GAME-06, GAME-07).
 *
 * Pure functions — all take PlainGameState, return NEW PlainGameState.
 * NEVER mutate input state. NEVER call Math.random().
 *
 * Functions:
 *   autoFire         — player fires toward nearest enemy every AUTO_FIRE_INTERVAL_TICKS
 *   applyEnemyAI     — swarmer/tank chase; ranged keep-distance + periodic fire (GAME-05)
 *   applyBossAI      — boss movement + D-19 idle->telegraphing->attacking state machine (Phase 5)
 *   applyProjectileMovement — move all projectiles, apply toroidal wrap, expire by lifetime
 *   applyCollisions  — UniformGrid broadphase; player proj→enemy; enemy proj→player; boss hits
 *   applyEnemyContactDamage — enemy overlapping player reduces player HP
 *   applyGemCollection — gems attract toward player; snap-collect awards XP
 *   applyLevelUp     — player levels up when xp >= XP_LEVEL_THRESHOLD
 *
 * Threat model:
 *   T-3-02: XP/level incremented only here, never from client message
 *   T-3-05: HP decremented only here, server-side
 *   T-3-06: Enemy projectiles created only when archetype==='ranged' + fire interval
 *
 * Phase 5 additions (weaponStats, kills, bosses — D-21/GAME-13/GAME-16):
 *   - weaponStats is keyed by player.weapons slot INDEX (string '0'-'5'), NOT weapon id.
 *     This survives weapon evolution and slot replacement (D-21).
 *   - Damage accumulation in weaponStats is CLAMPED to enemy remaining hp (no overkill
 *     counted) — reflects "damage dealt" semantics for the GameOverScreen DPS display.
 *   - state.kills counts only `enemies` map removals — `bosses` map removals are
 *     milestone events (GAME-13/BIOM-02), tracked via milestonesSpawned, not kills.
 *     See applyBossAI / applyCollisions boss-hit pass for boss removal logic.
 */

import type { PlainGameState, PlainPlayerState, PlainEnemyState, PlainBossState } from './state.js'
import { bossCatalog } from './bossCatalog.js'
import { UniformGrid, WORLD_W, WORLD_H } from './spatialGrid.js'
import type { Prng } from './prng.js'
import { XP_PER_ARCHETYPE, rollPickupDrop } from './spawn.js'
import type { PlayerInput } from './schemas.js'
import { weaponCatalog } from './weaponCatalog.js'

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

interface WeaponStats {
  id: string
  damage: number
  fireRateTicks: number
  projectileSpeed: number
}

function getWeaponStats(weaponId: string, level: number = 1): WeaponStats {
  if (weaponId === 'holy_wand') {
    return {
      id: 'holy_wand',
      damage: 30,
      fireRateTicks: 1,
      projectileSpeed: 15_000,
    }
  }
  if (weaponId === 'thousand_edge') {
    return {
      id: 'thousand_edge',
      damage: 40,
      fireRateTicks: 1,
      projectileSpeed: 20_000,
    }
  }
  const entry = weaponCatalog[weaponId]
  if (entry) {
    const dmgMults = [0.3, 0.5, 0.8, 1.1, 1.5]
    const cdMults = [1.5, 1.2, 1.0, 0.8, 0.6]
    const speedMults = [0.7, 0.85, 1.0, 1.1, 1.2]

    const lvlIdx = Math.max(1, Math.min(5, level)) - 1
    const dmgMult = dmgMults[lvlIdx]
    const cdMult = cdMults[lvlIdx]
    const speedMult = speedMults[lvlIdx]

    return {
      id: entry.id,
      damage: Math.round(entry.damage * dmgMult),
      fireRateTicks: Math.max(1, Math.round(entry.fireRateTicks * cdMult)),
      projectileSpeed: Math.round((entry.projectileSpeed / 10) * speedMult),
    }
  }
  return {
    id: 'magic_wand',
    damage: 10,
    fireRateTicks: 20,
    projectileSpeed: 15_000,
  }
}

/**
 * autoFire(state, inputs, prng) — fires player projectiles toward nearest enemy or movement direction.
 * Iterates through all player weapons, applying passive modifiers.
 *
 * Phase 5 additions:
 *   - Applies player.damageMultiplier / player.fireRateMultiplier (CHAR-01/02).
 *   - Tracks weapon slot index and sets weaponSlot on all created projectiles (D-21).
 *   - Eagerly initializes weaponStats[slotIndex] on first encounter (acquiredAtMs set on
 *     weapon acquisition, not first hit, so DPS display shows correct elapsed time).
 *   - Garlic branch accumulates damage directly into weaponStats (garlic has no projectile).
 *   - Garlic kills increment state.kills (must_haves: all enemies map removals count).
 */
export function autoFire(
  state: PlainGameState,
  inputs: Map<string, PlayerInput>,
  prng: Prng
): PlainGameState {
  const newProjectiles = new Map(state.projectiles)
  const newEnemies = new Map(state.enemies)
  const newGems = new Map(state.gems)
  const newPickups = new Map(state.pickups)
  const newPlayers = new Map(state.players)
  let changed = false
  let killsDelta = 0

  for (const [playerId, player] of state.players) {
    const playerWeapons =
      player.weapons && player.weapons.length > 0 ? player.weapons : ['magic_wand:1']

    let spinachLvl = 0
    let emptyTomeLvl = 0
    let bracerLvl = 0

    for (const p of player.passives) {
      const [pId, pLvlStr] = p.split(':')
      const level = pLvlStr ? parseInt(pLvlStr, 10) : 1
      if (pId === 'spinach') spinachLvl = level
      if (pId === 'empty_tome') emptyTomeLvl = level
      if (pId === 'bracer') bracerLvl = level
    }

    const SPINACH_MULTS = [1.0, 1.05, 1.1, 1.15, 1.2, 1.3]
    const EMPTY_TOME_MULTS = [1.0, 0.95, 0.9, 0.85, 0.8, 0.65]
    const BRACER_MULTS = [1.0, 1.05, 1.1, 1.15, 1.2, 1.35]

    const damageMult = SPINACH_MULTS[spinachLvl] || 1.0
    const speedMult = BRACER_MULTS[bracerLvl] || 1.0
    const cooldownMult = EMPTY_TOME_MULTS[emptyTomeLvl] || 1.0

    // Phase 5: class-based multipliers (CHAR-01/02). Default 1.0 for human.
    const classDamageMult = player.damageMultiplier ?? 1.0
    const classFireRateMult = player.fireRateMultiplier ?? 1.0

    for (let slotIdx = 0; slotIdx < playerWeapons.length; slotIdx++) {
      const weaponItem = playerWeapons[slotIdx]
      const slotIndex = String(slotIdx)
      const [weaponId, levelStr] = weaponItem.split(':')
      const level = levelStr ? parseInt(levelStr, 10) : 1
      const stats = getWeaponStats(weaponId, level)

      // Phase 5: apply class fire-rate multiplier multiplicatively with passive cooldownMult.
      // fireRateMultiplier < 1.0 means faster firing (e.g. vampire at 0.9 reduces cooldown ticks).
      const cooldown = Math.max(
        1,
        Math.round(stats.fireRateTicks * cooldownMult * classFireRateMult)
      )

      // Phase 5: eagerly initialize weaponStats[slotIndex] on first encounter so acquiredAtMs
      // is recorded at weapon acquisition time, not at first hit (D-21 DPS formula requires
      // accurate elapsed time from the moment the weapon was first active).
      const currentPlayer = newPlayers.get(playerId) ?? player
      const existingStats = currentPlayer.weaponStats ?? {}
      if (existingStats[slotIndex] === undefined) {
        const updatedStats = {
          ...existingStats,
          [slotIndex]: { totalDamage: 0, acquiredAtMs: state.elapsedMs },
        }
        newPlayers.set(playerId, { ...currentPlayer, weaponStats: updatedStats })
        changed = true
      }

      if (state.tick % cooldown !== 0) {
        continue
      }

      // Phase 5: class damage multiplier applied multiplicatively on top of passive damageMult.
      const damage = Math.round(stats.damage * damageMult * classDamageMult)
      const projectileSpeed = Math.round(stats.projectileSpeed * speedMult)

      if (weaponId === 'garlic') {
        const garlicRadiusMults = [0.6, 0.8, 1.0, 1.2, 1.5]
        const lvlIdx = Math.max(1, Math.min(5, level)) - 1
        const rMult = garlicRadiusMults[lvlIdx]
        const garlicRadius = 60_000 * rMult
        const garlicRadiusSq = garlicRadius * garlicRadius

        // Re-fetch player after possible weaponStats update above
        const garlicPlayer = newPlayers.get(playerId) ?? player
        const garlicStats = garlicPlayer.weaponStats ?? {}

        for (const [enemyId, enemy] of newEnemies) {
          const distSq = toroidalDistSq(garlicPlayer.x, garlicPlayer.y, enemy.x, enemy.y)
          if (distSq <= garlicRadiusSq) {
            // Clamp damage to remaining hp (no overkill counted — D-21 "damage dealt" semantics)
            const actualDamage = Math.min(damage, enemy.hp)
            const updatedHp = enemy.hp - damage

            // Accumulate clamped damage into weaponStats[slotIndex]
            const slotStat = garlicStats[slotIndex] ?? {
              totalDamage: 0,
              acquiredAtMs: state.elapsedMs,
            }
            const updatedSlotStat = {
              ...slotStat,
              totalDamage: slotStat.totalDamage + actualDamage,
            }
            const updatedWeaponStats = { ...garlicStats, [slotIndex]: updatedSlotStat }
            newPlayers.set(playerId, { ...garlicPlayer, weaponStats: updatedWeaponStats })
            // Keep local reference in sync
            Object.assign(garlicStats, updatedWeaponStats)

            if (updatedHp <= 0) {
              newEnemies.delete(enemyId)
              killsDelta++
              const gemId = `gem_${state.tick}_${enemyId}`
              const xpValue = XP_PER_ARCHETYPE[enemy.archetype]
              newGems.set(gemId, {
                id: gemId,
                x: enemy.x,
                y: enemy.y,
                value: xpValue,
              })
              const pickup = rollPickupDrop(enemy.archetype, enemy.x, enemy.y, prng)
              if (pickup !== null) {
                newPickups.set(pickup.id, pickup)
              }
            } else {
              newEnemies.set(enemyId, { ...enemy, hp: updatedHp })
            }
          }
        }
        changed = true
      } else if (weaponId === 'knife' || weaponId === 'thousand_edge') {
        const input = inputs?.get(playerId)
        let angle: number
        if (input && input.moveVector && (input.moveVector.x !== 0 || input.moveVector.y !== 0)) {
          angle = Math.atan2(input.moveVector.y, input.moveVector.x)
        } else if (input && input.aimAngle !== undefined) {
          angle = input.aimAngle
        } else {
          let nearestEnemy: PlainEnemyState | null = null
          let nearestDistSq = Infinity
          for (const enemy of state.enemies.values()) {
            const distSq = toroidalDistSq(player.x, player.y, enemy.x, enemy.y)
            if (distSq < nearestDistSq) {
              nearestDistSq = distSq
              nearestEnemy = enemy
            }
          }
          if (nearestEnemy !== null) {
            const dx = toroidalDelta(player.x, nearestEnemy.x, WORLD_W)
            const dy = toroidalDelta(player.y, nearestEnemy.y, WORLD_H)
            angle = Math.atan2(dy, dx)
          } else {
            angle = prng.next() * 2 * Math.PI
          }
        }

        const vx = Math.round(Math.cos(angle) * projectileSpeed)
        const vy = Math.round(Math.sin(angle) * projectileSpeed)
        const projId = `proj_${weaponId}_${state.tick}_${playerId}`

        newProjectiles.set(projId, {
          id: projId,
          x: player.x,
          y: player.y,
          vx,
          vy,
          ownerId: playerId,
          isEnemy: false,
          damage,
          lifetime: PLAYER_PROJECTILE_LIFETIME,
          weaponSlot: slotIndex,
        })
        changed = true
      } else if (weaponId === 'bible') {
        for (let i = 0; i < level; i++) {
          const projId = `bible_${state.tick}_${i}_${playerId}`
          newProjectiles.set(projId, {
            id: projId,
            x: player.x,
            y: player.y,
            vx: 0,
            vy: 0,
            ownerId: playerId,
            isEnemy: false,
            damage,
            lifetime: PLAYER_PROJECTILE_LIFETIME,
            weaponSlot: slotIndex,
          })
        }
        changed = true
      } else {
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
          angle = prng.next() * 2 * Math.PI
        }

        const vx = Math.round(Math.cos(angle) * projectileSpeed)
        const vy = Math.round(Math.sin(angle) * projectileSpeed)
        const projId = `proj_${weaponId}_${state.tick}_${playerId}`

        newProjectiles.set(projId, {
          id: projId,
          x: player.x,
          y: player.y,
          vx,
          vy,
          ownerId: playerId,
          isEnemy: false,
          damage,
          lifetime: PLAYER_PROJECTILE_LIFETIME,
          weaponSlot: slotIndex,
        })
        changed = true
      }
    }
  }

  if (!changed) return state
  return {
    ...state,
    projectiles: newProjectiles,
    enemies: newEnemies,
    gems: newGems,
    pickups: newPickups,
    players: newPlayers,
    kills: (state.kills ?? 0) + killsDelta,
  }
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

        // Phase 5: elite ranged (The Harvester, isElite===true) deal double projectile damage.
        const projDamage = enemy.isElite ? ENEMY_PROJECTILE_DAMAGE * 2 : ENEMY_PROJECTILE_DAMAGE

        const projId = `eproj_${state.tick}_${enemyId}`
        newProjectiles.set(projId, {
          id: projId,
          x: enemy.x,
          y: enemy.y,
          vx: ex_vx,
          vy: ex_vy,
          ownerId: enemyId,
          isEnemy: true,
          damage: projDamage,
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

// ─── applyBossAI ──────────────────────────────────────────────────────────────

/**
 * applyBossAI(state, prng) — boss movement and D-19 telegraph state machine.
 *
 * Telegraph cycle uses a 100-tick period (5 seconds at 20Hz) tracked via
 * boss.telegraphTick (range 0-99, wrapping):
 *   - ticks 0-79  → 'idle':        boss moves toward nearest player at boss.speed
 *   - ticks 80-98 → 'telegraphing': boss holds position, telegraphTick increments
 *   - tick 99     → 'attacking':   boss deals contact-radius damage to nearby players,
 *                                  then cycle resets (telegraphTick wraps to 0 → 'idle')
 *
 * telegraphState is derived from telegraphTick:
 *   telegraphTick < 80 → 'idle'
 *   telegraphTick < 99 → 'telegraphing'
 *   telegraphTick >= 99 → 'attacking' (exactly the 99th tick)
 *
 * IMPORTANT: always use `boss.telegraphTick ?? 0` — undefined telegraphTick
 * (freshly-spawned boss) must default to 0, not trigger 'attacking' on first tick.
 *
 * Wired into simulateTick pipeline in plan 05-06.
 */
export function applyBossAI(state: PlainGameState): PlainGameState {
  const bosses = state.bosses
  if (!bosses || bosses.size === 0 || state.players.size === 0) return state

  const newBosses = new Map<string, PlainBossState>()
  const newPlayers = new Map(state.players)
  let playersChanged = false

  for (const [bossId, boss] of bosses) {
    const telegraphTick = boss.telegraphTick ?? 0
    const nextTelegraphTick = (telegraphTick + 1) % 100

    let telegraphState: 'idle' | 'telegraphing' | 'attacking'
    if (telegraphTick < 80) {
      telegraphState = 'idle'
    } else if (telegraphTick < 99) {
      telegraphState = 'telegraphing'
    } else {
      telegraphState = 'attacking'
    }

    let newX = boss.x
    let newY = boss.y

    if (telegraphState === 'idle') {
      // Move toward nearest player at boss.speed
      const target = nearestPlayer(boss.x, boss.y, state.players)
      if (target !== null) {
        const dx = toroidalDelta(boss.x, target.x, WORLD_W)
        const dy = toroidalDelta(boss.y, target.y, WORLD_H)
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > 0) {
          const nx = dx / dist
          const ny = dy / dist
          newX = toroidal(boss.x + Math.round(nx * boss.speed), WORLD_W)
          newY = toroidal(boss.y + Math.round(ny * boss.speed), WORLD_H)
        }
      }
    }
    // 'telegraphing': hold position (no movement)
    // 'attacking': deal damage this tick, then transition to idle

    if (telegraphState === 'attacking') {
      // Deal contact damage to all players within attack radius
      const catalogEntry = bossCatalog[boss.bossKey]
      const attackDamage = catalogEntry?.contactDamage ?? 10

      if (boss.bossKey === 'patient_zero') {
        // Ground slam: circular radius check around current boss position
        const attackRadius = ENEMY_CONTACT_RADIUS * 3
        const attackRadiusSq = attackRadius * attackRadius
        for (const [playerId, player] of newPlayers) {
          const distSq = toroidalDistSq(boss.x, boss.y, player.x, player.y)
          if (distSq <= attackRadiusSq) {
            const updatedHp = Math.max(0, player.hp - attackDamage)
            newPlayers.set(playerId, { ...player, hp: updatedHp })
            playersChanged = true
          }
        }
      } else if (boss.bossKey === 'unfinished_one') {
        // Charge lunge: approximate as two radius checks — at boss position and
        // at midpoint toward nearest player (D-19 charge vector approximation).
        const attackRadius = ENEMY_CONTACT_RADIUS * 2
        const attackRadiusSq = attackRadius * attackRadius
        const chargeTarget = nearestPlayer(boss.x, boss.y, state.players)
        const midX = chargeTarget
          ? toroidal(
              boss.x + Math.round(toroidalDelta(boss.x, chargeTarget.x, WORLD_W) / 2),
              WORLD_W
            )
          : boss.x
        const midY = chargeTarget
          ? toroidal(
              boss.y + Math.round(toroidalDelta(boss.y, chargeTarget.y, WORLD_H) / 2),
              WORLD_H
            )
          : boss.y

        for (const [playerId, player] of newPlayers) {
          const distSqCenter = toroidalDistSq(boss.x, boss.y, player.x, player.y)
          const distSqMid = toroidalDistSq(midX, midY, player.x, player.y)
          if (distSqCenter <= attackRadiusSq || distSqMid <= attackRadiusSq) {
            const updatedHp = Math.max(0, player.hp - attackDamage)
            newPlayers.set(playerId, { ...player, hp: updatedHp })
            playersChanged = true
          }
        }
      }
    }

    newBosses.set(bossId, {
      ...boss,
      x: newX,
      y: newY,
      telegraphTick: nextTelegraphTick,
      telegraphState,
    })
  }

  const result: PlainGameState = { ...state, bosses: newBosses }
  if (playersChanged) {
    result.players = newPlayers
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

    if (id.startsWith('bible_')) {
      const owner = state.players.get(proj.ownerId)
      if (owner) {
        const parts = id.split('_')
        const spawnTick = parseInt(parts[1] || '0', 10)
        const index = parseInt(parts[2] || '0', 10)

        let bibleLvl = 1
        const bibleItem = owner.weapons.find((w) => w.startsWith('bible'))
        if (bibleItem) {
          bibleLvl = parseInt(bibleItem.split(':')[1] || '1', 10)
        }

        const orbitRadius = 60_000 // 60 game units in sub-units
        const angle = state.tick * 0.08 + spawnTick * 0.1 + index * ((2 * Math.PI) / bibleLvl)

        newProjectiles.set(id, {
          ...proj,
          x: toroidal(owner.x + Math.round(Math.cos(angle) * orbitRadius), WORLD_W),
          y: toroidal(owner.y + Math.round(Math.sin(angle) * orbitRadius), WORLD_H),
          lifetime: newLifetime,
        })
        continue
      }
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
 *   Hit → decrement enemy.hp; if hp <= 0: remove enemy, drop gem, increment kills.
 *   Accumulate clamped damage into owner's weaponStats[proj.weaponSlot] (D-21).
 *   Remove projectile on first hit.
 *
 * Pass 1b: Player projectiles vs bosses (additive scan after enemy check).
 *   Boss removal does NOT increment state.kills (see Phase 5 comment block above).
 *
 * Pass 2: Enemy projectiles (isEnemy===true) vs players.
 *   Hit → player.hp = max(0, player.hp - damage); remove projectile.
 *
 * T-3-05 mitigation: HP decremented server-side only from authoritative state.
 *
 * Boss removal from state.bosses does NOT increment state.kills — bosses are
 * milestone events (GAME-13/BIOM-02), tracked via milestonesSpawned, not via
 * the kills counter (see 05-01 decision log).
 */
export function applyCollisions(state: PlainGameState, prng: Prng): PlainGameState {
  const newEnemies = new Map(state.enemies)
  const newPlayers = new Map(state.players)
  const newProjectiles = new Map(state.projectiles)
  const newGems = new Map(state.gems)
  const newPickups = new Map(state.pickups)
  const newBosses = new Map(state.bosses ?? new Map<string, PlainBossState>())
  let changed = false
  let killsDelta = 0

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

        // Clamp damage to remaining hp (no overkill — D-21 "damage dealt" semantics)
        const actualDamage = Math.min(proj.damage, enemy.hp)
        const updatedHp = enemy.hp - proj.damage

        // Accumulate clamped damage into owner's weaponStats[weaponSlot]
        if (proj.weaponSlot !== undefined) {
          const owner = newPlayers.get(proj.ownerId)
          if (owner !== undefined) {
            const ownerStats = owner.weaponStats ?? {}
            const slotStat = ownerStats[proj.weaponSlot] ?? {
              totalDamage: 0,
              acquiredAtMs: state.elapsedMs,
            }
            const updatedSlotStat = {
              ...slotStat,
              totalDamage: slotStat.totalDamage + actualDamage,
            }
            newPlayers.set(proj.ownerId, {
              ...owner,
              weaponStats: { ...ownerStats, [proj.weaponSlot]: updatedSlotStat },
            })
          }
        }

        if (updatedHp <= 0) {
          // Enemy dead: drop gem at death position, increment kills
          newEnemies.delete(enemyId)
          killsDelta++
          const gemId = `gem_${state.tick}_${enemyId}`
          const xpValue = XP_PER_ARCHETYPE[enemy.archetype]
          newGems.set(gemId, {
            id: gemId,
            x: enemy.x,
            y: enemy.y,
            value: xpValue,
          })

          const pickup = rollPickupDrop(enemy.archetype, enemy.x, enemy.y, prng)
          if (pickup !== null) {
            newPickups.set(pickup.id, pickup)
          }
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

  // ── Pass 1b: Player projectiles vs bosses (additive, after enemy check) ──
  // state.bosses is bounded to 1-2 active entries — linear scan is acceptable (T-05-06 accept).
  if (newBosses.size > 0) {
    for (const [projId, proj] of state.projectiles) {
      if (proj.isEnemy) continue // skip enemy projectiles
      if (!newProjectiles.has(projId)) continue // already consumed by Pass 1

      for (const [bossId, boss] of newBosses) {
        const distSq = toroidalDistSq(proj.x, proj.y, boss.x, boss.y)
        if (distSq > PROJECTILE_HIT_RADIUS * PROJECTILE_HIT_RADIUS) continue

        // Hit: clamp damage to remaining boss hp
        const actualDamage = Math.min(proj.damage, boss.hp)

        // Accumulate clamped damage into owner's weaponStats[weaponSlot]
        if (proj.weaponSlot !== undefined) {
          const owner = newPlayers.get(proj.ownerId)
          if (owner !== undefined) {
            const ownerStats = owner.weaponStats ?? {}
            const slotStat = ownerStats[proj.weaponSlot] ?? {
              totalDamage: 0,
              acquiredAtMs: state.elapsedMs,
            }
            const updatedSlotStat = {
              ...slotStat,
              totalDamage: slotStat.totalDamage + actualDamage,
            }
            newPlayers.set(proj.ownerId, {
              ...owner,
              weaponStats: { ...ownerStats, [proj.weaponSlot]: updatedSlotStat },
            })
          }
        }

        const updatedBossHp = boss.hp - proj.damage
        if (updatedBossHp <= 0) {
          // Boss dead: remove from bosses map — do NOT increment kills.
          // Boss removal is a milestone event, tracked via milestonesSpawned (GAME-13/BIOM-02).
          newBosses.delete(bossId)
        } else {
          newBosses.set(bossId, { ...boss, hp: updatedBossHp })
        }

        // Remove the projectile after first boss hit
        newProjectiles.delete(projId)
        changed = true
        break // one projectile hits one boss
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

  if (
    !changed &&
    killsDelta === 0 &&
    newEnemies.size === state.enemies.size &&
    newGems.size === state.gems.size &&
    newPickups.size === state.pickups.size
  ) {
    return state
  }
  return {
    ...state,
    enemies: newEnemies,
    players: newPlayers,
    projectiles: newProjectiles,
    gems: newGems,
    pickups: newPickups,
    bosses: newBosses,
    kills: (state.kills ?? 0) + killsDelta,
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

export function getXpThresholdForLevel(level: number): number {
  const base = 10
  if (level <= 1) return base
  const scale = 1 + (level - 1) * 0.002 + (level - 1) * (level - 2) * 0.0005
  return Math.max(base, Math.round(base * scale))
}

/**
 * applyLevelUp(state) — level up players that have reached their level threshold.
 * Repeating: while xp >= threshold, level++, xp -= threshold.
 * T-3-02 mitigation: level only incremented here, never from client message.
 */
export function applyLevelUp(state: PlainGameState): PlainGameState {
  let changed = false
  const newPlayers = new Map(state.players)

  for (const [playerId, player] of state.players) {
    let threshold = getXpThresholdForLevel(player.level)
    if (player.xp >= threshold) {
      let { xp, level } = player
      while (xp >= threshold) {
        xp -= threshold
        level++
        threshold = getXpThresholdForLevel(level)
      }
      newPlayers.set(playerId, { ...player, xp, level })
      changed = true
    }
  }

  if (!changed) return state
  return { ...state, players: newPlayers }
}

export const PICKUP_COLLECT_RADIUS = 10_000 // 1 game unit (same as GEM_COLLECT_SNAP)

/**
 * applyPickupCollection — checks player proximity to pickups and applies collection effects (GAME-17).
 */
export function applyPickupCollection(state: PlainGameState): PlainGameState {
  if (state.pickups.size === 0 || state.players.size === 0) return state

  const newPickups = new Map(state.pickups)
  const newPlayers = new Map(state.players)
  const newGems = new Map(state.gems)
  const newEnemies = new Map(state.enemies)
  let changed = false
  let killsDelta = 0

  const radiusSq = PICKUP_COLLECT_RADIUS * PICKUP_COLLECT_RADIUS

  for (const [playerId, player] of state.players) {
    const updatedPlayer = newPlayers.get(playerId) ?? { ...player }

    for (const [pickupId, pickup] of newPickups) {
      const distSq = toroidalDistSq(updatedPlayer.x, updatedPlayer.y, pickup.x, pickup.y)
      if (distSq <= radiusSq) {
        newPickups.delete(pickupId)

        if (pickup.kind === 'health_orb') {
          updatedPlayer.hp = Math.min(updatedPlayer.hp + 20, updatedPlayer.maxHp)
          newPlayers.set(playerId, updatedPlayer)
        } else if (pickup.kind === 'xp_magnet') {
          for (const [gemId, gem] of newGems) {
            newGems.set(gemId, { ...gem, x: updatedPlayer.x, y: updatedPlayer.y })
          }
        } else if (pickup.kind === 'screen_bomb') {
          killsDelta += newEnemies.size
          newEnemies.clear()
        }

        changed = true
        break // one pickup per player per frame
      }
    }
  }

  if (!changed) return state

  return {
    ...state,
    pickups: newPickups,
    players: newPlayers,
    gems: newGems,
    enemies: newEnemies,
    kills: (state.kills ?? 0) + killsDelta,
  }
}
