/**
 * runMilestones — milestone spawn schedule (D-12/D-15, GAME-13/14/15, BIOM-02).
 *
 * `MILESTONE_MS` is the elapsedMs threshold table for the 30-minute run arc.
 * `checkMilestoneSpawns(state, prng)` is a pure function: for each milestone
 * not yet fired, once `state.elapsedMs >= MILESTONE_MS[id]`, it spawns the
 * corresponding elite enemy or boss and marks `milestonesSpawned[id] = true`.
 *
 * CRITICAL (T-05-02, determinism): this function calls `prng.next()` to
 * position spawned elites (mirroring spawn.ts's toroidal-offset convention).
 * This is a NEW PRNG consumption point. It MUST be called from
 * simulateTick's pipeline at a fixed, documented step (step 5, alongside
 * spawnEnemies — see plan 05-06) so that two runs seeded identically consume
 * the PRNG in the same order and remain bit-for-bit deterministic.
 *
 * Never mutates `state` — returns a new PlainGameState via spread + new
 * Map/object, following the idiom used throughout spawn.ts/weapons.ts.
 */
import type { PlainGameState, PlainEnemyState, PlainBossState } from './state.js'
import type { Prng } from './prng.js'
import { WORLD_W, WORLD_H } from './spatialGrid.js'
import { eliteCatalog } from './eliteCatalog.js'
import { bossCatalog, scaleFinalBossStats } from './bossCatalog.js'

export type MilestoneId = 'elite1' | 'elite2' | 'elite3' | 'elite4' | 'biomeBoss' | 'finalBoss'

/**
 * Milestone elapsedMs thresholds (20Hz, 50ms/tick):
 *   elite1:    360_000ms  = tick 7200  (6 min)
 *   elite2:    720_000ms  = tick 14400 (12 min)
 *   elite3:  1_080_000ms  = tick 21600 (18 min)
 *   biomeBoss: 1_200_000ms = tick 24000 (20 min)
 *   elite4:  1_440_000ms  = tick 28800 (24 min)
 *   finalBoss: 1_800_000ms = tick 36000 (30 min)
 */
export const MILESTONE_MS: Record<MilestoneId, number> = {
  elite1: 360_000,
  elite2: 720_000,
  elite3: 1_080_000,
  biomeBoss: 1_200_000,
  elite4: 1_440_000,
  finalBoss: 1_800_000,
}

// Order matters only for PRNG-consumption determinism — milestones are
// checked in this fixed order every tick so the same-seed run always
// consumes prng.next() calls in the same sequence.
const MILESTONE_ORDER: MilestoneId[] = [
  'elite1',
  'elite2',
  'elite3',
  'biomeBoss',
  'elite4',
  'finalBoss',
]

const ELITE_IDS = new Set<MilestoneId>(['elite1', 'elite2', 'elite3', 'elite4'])

/**
 * Compute a toroidal spawn position offset from the first player, mirroring
 * spawn.ts's spawnEnemies positioning convention (600,000 sub-units away at
 * a random angle). Falls back to world-center-relative if no players exist.
 */
function rollSpawnPosition(state: PlainGameState, prng: Prng): { x: number; y: number } {
  const angle = prng.next() * 2 * Math.PI
  const dx = Math.round(Math.cos(angle) * 600_000)
  const dy = Math.round(Math.sin(angle) * 600_000)

  if (state.players.size > 0) {
    const players = [...state.players.values()]
    const player = players[0]!
    return {
      x: (((player.x + dx) % WORLD_W) + WORLD_W) % WORLD_W,
      y: (((player.y + dy) % WORLD_H) + WORLD_H) % WORLD_H,
    }
  }

  const centerX = Math.floor(WORLD_W / 2)
  const centerY = Math.floor(WORLD_H / 2)
  return {
    x: (((centerX + dx) % WORLD_W) + WORLD_W) % WORLD_W,
    y: (((centerY + dy) % WORLD_H) + WORLD_H) % WORLD_H,
  }
}

/**
 * checkMilestoneSpawns(state, prng) — returns new state with any
 * newly-eligible milestone elites/bosses spawned and `milestonesSpawned`
 * updated. Does not mutate `state`.
 */
export function checkMilestoneSpawns(state: PlainGameState, prng: Prng): PlainGameState {
  const milestonesSpawned: Record<string, boolean> = { ...(state.milestonesSpawned ?? {}) }
  const enemies = new Map(state.enemies)
  const bosses = new Map(state.bosses ?? new Map())
  let changed = false

  for (const id of MILESTONE_ORDER) {
    if (milestonesSpawned[id]) continue
    if (state.elapsedMs < MILESTONE_MS[id]) continue

    if (ELITE_IDS.has(id)) {
      const entry = eliteCatalog[id]!
      const { x, y } = rollSpawnPosition(state, prng)
      const enemyId = `elite_${id}_${state.tick}`
      const enemy: PlainEnemyState = {
        id: enemyId,
        x,
        y,
        hp: entry.hp,
        maxHp: entry.maxHp,
        archetype: entry.spawnArchetype,
        speed: entry.speed,
        lastFireTick: 0,
        isElite: true,
        eliteName: entry.displayName,
      }
      enemies.set(enemyId, enemy)
    } else if (id === 'biomeBoss') {
      const entry = bossCatalog.patient_zero!
      const { x, y } = rollSpawnPosition(state, prng)
      const boss: PlainBossState = {
        id: 'boss_patient_zero',
        bossKey: entry.bossKey,
        name: entry.name,
        x,
        y,
        hp: entry.baseHp,
        maxHp: entry.baseHp,
        speed: entry.baseSpeed,
        telegraphState: 'idle',
      }
      bosses.set('boss_patient_zero', boss)
    } else if (id === 'finalBoss') {
      const entry = bossCatalog.unfinished_one!
      const scaled = scaleFinalBossStats(entry, 0)
      const { x, y } = rollSpawnPosition(state, prng)
      const boss: PlainBossState = {
        id: 'boss_unfinished_one',
        bossKey: entry.bossKey,
        name: entry.name,
        x,
        y,
        hp: scaled.hp,
        maxHp: scaled.hp,
        speed: scaled.speed,
        telegraphState: 'idle',
      }
      bosses.set('boss_unfinished_one', boss)
    }

    milestonesSpawned[id] = true
    changed = true
  }

  if (!changed) {
    return state
  }

  return {
    ...state,
    enemies,
    bosses,
    milestonesSpawned,
  }
}
