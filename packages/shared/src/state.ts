/**
 * PlainGameState and related entity types.
 * makeInitialState(seed) creates a fresh run state.
 *
 * IMPORTANT: makeInitialState creates one player ('p1') for single-player
 * runs. The movement tests require at least one player to exist.
 * Position defaults to world center (2,048,000 sub-units).
 */

import { WORLD_W, WORLD_H } from './spatialGrid.js'

export type PlainPickupState = {
  id: string
  x: number
  y: number
  kind: 'health_orb' | 'xp_magnet' | 'screen_bomb'
}

export type PlainPlayerState = {
  id: string
  x: number
  y: number
  hp: number
  maxHp: number
  level: number
  xp: number
  speed: number
  weapons: string[]
  passives: string[]
  // Phase 5: character class identity (CHAR-01/02/03). Default 'human'.
  classId?: 'vampire' | 'human' | 'dwarf'
  // Phase 5: class-based stat multipliers (D-03/D-04). Default 1.0.
  damageMultiplier?: number
  fireRateMultiplier?: number
  // Phase 5: per-slot weapon damage tracking, keyed by weapon-array SLOT INDEX
  // (string '0'-'5'), NOT weapon id — survives evolution/slot replacement (D-21).
  // Default {}.
  weaponStats?: Record<string, { totalDamage: number; acquiredAtMs: number }>
  // Phase 6: coop downed state (ROOM-07). Set inside applyDownedRevive when hp
  // hits 0 in coop mode; hp stays 0 while downed. Default undefined (never set
  // in solo mode).
  downed?: boolean
  // Phase 6: bleed-out clock in ms, 30_000 → 0 while downed (ROOM-07).
  // Decrements 50/tick inside the sim — the ONLY death clock while downed.
  bleedOutRemainingMs?: number
  // Phase 6: consecutive ticks an alive teammate has stayed within
  // REVIVE_RADIUS (ROOM-08). Resets to 0 on any gap; revive at 60 (3s).
  reviveProgressTicks?: number
  // Phase 6: bleed-out expired — spectator (ROOM-09). Eliminated players stay
  // in state.players (removing would shift scaling and HUD) and are skipped by
  // every sim pass.
  eliminated?: boolean
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
  // Phase 5: set true when this enemy was spawned as a milestone elite.
  isElite?: boolean
  // Phase 5: display name shown when isElite is true (e.g. "Stitched Orderly").
  eliteName?: string
}

// Phase 5: milestone boss entity (biome boss / final boss). Lives in
// PlainGameState.bosses, separate from the regular `enemies` map — boss
// deaths do NOT increment `kills`.
export type PlainBossState = {
  id: string
  bossKey: 'patient_zero' | 'unfinished_one'
  name: string
  x: number
  y: number
  hp: number
  maxHp: number
  speed: number
  telegraphState?: 'idle' | 'telegraphing' | 'attacking'
  telegraphTick?: number
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
  // Phase 5: slot index (string) into owner's player.weapons array for the
  // weapon that created this projectile. Used by applyCollisions to accumulate
  // damage into player.weaponStats[weaponSlot] (D-21 / GAME-16).
  weaponSlot?: string
}

export type PlainGameState = {
  tick: number
  elapsedMs: number
  players: Map<string, PlainPlayerState>
  enemies: Map<string, PlainEnemyState>
  gems: Map<string, PlainGemState>
  projectiles: Map<string, PlainProjectileState>
  pickups: Map<string, PlainPickupState>
  prngSeed: number
  // Phase 5: enemy kills (NOT boss deaths — see PlainBossState). Default 0.
  kills?: number
  // Phase 5: milestone bosses (biome boss / final boss). Default new Map().
  bosses?: Map<string, PlainBossState>
  // Phase 5: which milestone events have already fired. Keys: 'elite1',
  // 'elite2', 'elite3', 'elite4', 'biomeBoss', 'finalBoss'. Default {}.
  milestonesSpawned?: Record<string, boolean>
  // Phase 5: run outcome (GAME-12). Set to 'defeated' inside simulateTick
  // when any player's hp reaches 0 (solo) or when EVERY player is downed or
  // eliminated (coop — Phase 6). 'survived' is set by the room on
  // disconnect/leave, never inside simulateTick.
  result?: 'survived' | 'defeated' | undefined
  // Phase 6: sim mode — gates the downed/revive pipeline and coop defeat rule.
  // Set by the room at creation. Default 'solo' (makeInitialState) so the solo
  // path stays byte-identical to Phase 5.
  mode?: 'solo' | 'coop'
  // Phase 6: player count captured at run start (frozen across disconnects —
  // OQ2). Drives difficulty scaling (ROOM-10). Default 1.
  playerCount?: number
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
    weapons: [],
    passives: [],
    classId: 'human',
    damageMultiplier: 1.0,
    fireRateMultiplier: 1.0,
    weaponStats: {},
  }

  return {
    tick: 0,
    elapsedMs: 0,
    players: new Map([['p1', p1]]),
    enemies: new Map(),
    gems: new Map(),
    projectiles: new Map(),
    pickups: new Map(),
    prngSeed: seed,
    kills: 0,
    bosses: new Map(),
    milestonesSpawned: {},
    result: undefined,
    // Phase 6: explicit documented defaults (Pitfall 1 — makeInitialState
    // coverage). Rooms override to 'coop' / N at run start. Player downed
    // fields stay undefined until the pipeline sets them.
    mode: 'solo',
    playerCount: 1,
  }
}
