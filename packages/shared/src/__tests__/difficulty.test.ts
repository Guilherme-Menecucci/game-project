/**
 * difficulty.test.ts — co-op difficulty scaling spec (ROOM-10).
 *
 * Locked decisions encoded here (CONTEXT):
 *   - Spawn rate x1.0 / x1.6 / x2.2 / x2.8 for 1-4 players → the spawn
 *     interval is the Phase 5 solo interval DIVIDED by SPAWN_RATE_MULT[n]
 *     (divided after the 300ms floor; not re-clamped).
 *   - Enemy HP +20% per extra player, applied at spawn time:
 *     Math.round(baseHp * (1 + 0.2 * (n - 1))). Milestone elites use the same
 *     formula. Biome boss and final boss HP are multiplied by n.
 *   - Difficulty derives ONLY from state.playerCount (frozen at run start,
 *     OQ2) and only when state.mode === 'coop'. Solo is never scaled.
 *   - Coop spawn anchor: ONE prng draw selects a non-eliminated player
 *     (downed players may anchor, eliminated ones never). Solo performs NO new
 *     draw — its prng sequence stays byte-identical to Phase 5 (Pitfall 2).
 *   - MAX_ENEMIES_CAP stays 300 (GAME-18 perf budget) even at 4 players.
 *
 * NOTE: the solo-identity, solo draw-count and cap cases are GUARD tests —
 * they already pass before the scaling exists (they lock Phase 5 behaviour
 * that this plan must not disturb). The scaling/anchor cases are the RED spec.
 */
import { describe, it, expect } from 'vitest'
import * as shared from '@game/shared'
import {
  spawnEnemies,
  checkMilestoneSpawns,
  makeInitialState,
  mulberry32,
  eliteCatalog,
  bossCatalog,
  scaleFinalBossStats,
  WORLD_W,
  WORLD_H,
} from '@game/shared'
import type { PlainGameState, PlainEnemyState, PlainPlayerState, Prng } from '@game/shared'

// Forward-typed view of the 06-07 exports (typechecks at RED before spawn.ts
// gains them; a no-op intersection after GREEN).
const S = shared as typeof shared & {
  SPAWN_RATE_MULT: readonly number[]
  spawnIntervalMs: (elapsedMs: number, playerCount?: number) => number
  MAX_ENEMIES_CAP: number
}

const CENTER = 2_048_000
const SPAWN_DIST = 600_000

/** Phase 5 solo interval formula, asserted independently of spawn.ts. */
function phase5Interval(elapsedMs: number): number {
  return Math.max(300, 2000 - elapsedMs * 0.02)
}

/** +20% per extra player, rounded at spawn. */
function scaledHp(base: number, n: number): number {
  return Math.round(base * (1 + 0.2 * (n - 1)))
}

/** Prng wrapper that counts next() calls without altering the sequence. */
function countingPrng(seed: number): Prng & { calls: () => number } {
  const inner = mulberry32(seed)
  let calls = 0
  return {
    next: () => {
      calls++
      return inner.next()
    },
    state: () => inner.state(),
    calls: () => calls,
  }
}

/** n players spread far apart; mode 'coop', playerCount n. */
function makeCoopState(n: number, seed = 7): PlainGameState {
  const state = makeInitialState(seed)
  state.mode = 'coop'
  state.playerCount = n
  const p1 = state.players.get('p1')!
  const spots: Array<[number, number]> = [
    [CENTER, CENTER],
    [CENTER + 1_000_000, CENTER],
    [CENTER, CENTER + 1_500_000],
    [CENTER - 1_300_000, CENTER - 900_000],
  ]
  p1.x = spots[0]![0]
  p1.y = spots[0]![1]
  for (let i = 2; i <= n; i++) {
    state.players.set(`p${i}`, {
      ...p1,
      id: `p${i}`,
      x: spots[i - 1]![0],
      y: spots[i - 1]![1],
      weapons: [...p1.weapons],
      passives: [...p1.passives],
      weaponStats: {},
    })
  }
  return state
}

function torDist(ax: number, ay: number, bx: number, by: number): number {
  let dx = Math.abs(ax - bx)
  let dy = Math.abs(ay - by)
  dx = Math.min(dx, WORLD_W - dx)
  dy = Math.min(dy, WORLD_H - dy)
  return Math.sqrt(dx * dx + dy * dy)
}

/** Which players sit exactly SPAWN_DIST (±3 rounding) from the point. */
function anchorsOf(state: PlainGameState, x: number, y: number): string[] {
  const out: string[] = []
  for (const p of state.players.values()) {
    if (Math.abs(torDist(p.x, p.y, x, y) - SPAWN_DIST) <= 3) out.push(p.id)
  }
  return out
}

function onlyEnemy(state: PlainGameState): PlainEnemyState {
  expect(state.enemies.size).toBe(1)
  return [...state.enemies.values()][0]!
}

/** Mark every milestone except `keep` as already fired. */
function onlyMilestone(state: PlainGameState, keep: string): void {
  const all = ['elite1', 'elite2', 'elite3', 'biomeBoss', 'elite4', 'finalBoss']
  state.milestonesSpawned = Object.fromEntries(all.filter((k) => k !== keep).map((k) => [k, true]))
}

const MILESTONE_ELAPSED: Record<string, number> = {
  elite1: 360_000,
  elite2: 720_000,
  elite3: 1_080_000,
  biomeBoss: 1_200_000,
  elite4: 1_440_000,
  finalBoss: 1_800_000,
}

// ─── Spawn rate ──────────────────────────────────────────────────────────────

describe('difficulty — spawn rate (ROOM-10)', () => {
  it('SPAWN_RATE_MULT is [1.0, 1.0, 1.6, 2.2, 2.8] (index = playerCount)', () => {
    expect([...S.SPAWN_RATE_MULT]).toEqual([1.0, 1.0, 1.6, 2.2, 2.8])
  })

  it('spawnIntervalMs(elapsed, 1) equals the Phase 5 value exactly', () => {
    for (const t of [0, 1_000, 50_000, 84_999, 85_000, 200_000, 1_800_000]) {
      expect(S.spawnIntervalMs(t, 1)).toBe(phase5Interval(t))
      expect(S.spawnIntervalMs(t)).toBe(phase5Interval(t))
    }
  })

  it('spawnIntervalMs for 2/3/4 players is the solo value / 1.6, 2.2, 2.8', () => {
    const mult: Record<number, number> = { 2: 1.6, 3: 2.2, 4: 2.8 }
    for (const n of [2, 3, 4]) {
      for (const t of [0, 50_000, 200_000]) {
        expect(S.spawnIntervalMs(t, n)).toBe(phase5Interval(t) / mult[n]!)
      }
    }
  })

  it('coop-4 spawns at tick 14 from t=0; coop-2, coop-3 and solo do not', () => {
    // interval at t=0: solo 2000ms (40 ticks), coop-2 1250 (25), coop-3 909 (18),
    // coop-4 714.28 (14).
    const run = (state: PlainGameState): number => {
      state.tick = 14
      return spawnEnemies(state, mulberry32(3)).enemies.size
    }
    expect(run(makeCoopState(4))).toBe(1)
    expect(run(makeCoopState(3))).toBe(0)
    expect(run(makeCoopState(2))).toBe(0)
    expect(run(makeInitialState(3))).toBe(0)
  })

  it('MAX_ENEMIES_CAP is still 300 and enforced in coop at 4 players', () => {
    expect(S.MAX_ENEMIES_CAP).toBe(300)
    const state = makeCoopState(4)
    state.elapsedMs = 1_000_000
    state.tick = 0
    for (let i = 0; i < 300; i++) {
      state.enemies.set(`x${i}`, {
        id: `x${i}`,
        x: 0,
        y: 0,
        hp: 1,
        maxHp: 1,
        archetype: 'swarmer',
        speed: 7_500,
        lastFireTick: 0,
      })
    }
    expect(spawnEnemies(state, mulberry32(9)).enemies.size).toBe(300)
  })
})

// ─── Enemy HP ────────────────────────────────────────────────────────────────

describe('difficulty — enemy HP at spawn (ROOM-10)', () => {
  const BASE: Record<string, number> = { swarmer: 1, tank: 10, ranged: 3 }

  it('coop enemy hp/maxHp = round(base * (1 + 0.2 * (n - 1)))', () => {
    for (const n of [1, 2, 3, 4]) {
      let seen = 0
      for (let seed = 1; seed <= 60; seed++) {
        const state = makeCoopState(n, seed)
        state.elapsedMs = 200_000 // mixed archetypes
        state.tick = 0
        const e = onlyEnemy(spawnEnemies(state, mulberry32(seed)))
        expect(e.hp).toBe(scaledHp(BASE[e.archetype]!, n))
        expect(e.maxHp).toBe(e.hp)
        seen++
      }
      expect(seen).toBe(60)
    }
  })

  it('a coop-4 tank spawns with 16 hp (10 * 1.6)', () => {
    let found = false
    for (let seed = 1; seed <= 200 && !found; seed++) {
      const state = makeCoopState(4, seed)
      state.elapsedMs = 200_000
      const e = onlyEnemy(spawnEnemies(state, mulberry32(seed)))
      if (e.archetype === 'tank') {
        expect(e.hp).toBe(16)
        found = true
      }
    }
    expect(found).toBe(true)
  })

  it('solo is never scaled, even if playerCount were corrupted (mode gate)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const state = makeInitialState(seed)
      state.playerCount = 4 // bogus — solo must ignore it
      state.elapsedMs = 200_000
      const e = onlyEnemy(spawnEnemies(state, mulberry32(seed)))
      expect(e.hp).toBe(BASE[e.archetype])
    }
  })
})

// ─── Milestone elites and bosses ─────────────────────────────────────────────

describe('difficulty — milestone elites and bosses (ROOM-10)', () => {
  it('elite hp/maxHp use the +20%/extra-player formula', () => {
    for (const id of ['elite1', 'elite2', 'elite3', 'elite4']) {
      for (const n of [1, 2, 3, 4]) {
        const state = makeCoopState(n)
        state.elapsedMs = MILESTONE_ELAPSED[id]!
        onlyMilestone(state, id)
        const next = checkMilestoneSpawns(state, mulberry32(11))
        const elite = [...next.enemies.values()].find((e) => e.isElite)!
        expect(elite.hp).toBe(scaledHp(eliteCatalog[id]!.hp, n))
        expect(elite.maxHp).toBe(scaledHp(eliteCatalog[id]!.maxHp, n))
      }
    }
  })

  it('biome boss (patient zero) hp = baseHp * playerCount', () => {
    for (const n of [1, 2, 3, 4]) {
      const state = makeCoopState(n)
      state.elapsedMs = MILESTONE_ELAPSED.biomeBoss!
      onlyMilestone(state, 'biomeBoss')
      const boss = checkMilestoneSpawns(state, mulberry32(5)).bosses!.get('boss_patient_zero')!
      expect(boss.hp).toBe(bossCatalog.patient_zero!.baseHp * n)
      expect(boss.hp).toBe(3000 * n)
      expect(boss.maxHp).toBe(boss.hp)
    }
  })

  it('final boss hp = scaled final-boss hp * playerCount (80,000 x 4 fits uint32)', () => {
    const scaled = scaleFinalBossStats(bossCatalog.unfinished_one!, 0)
    for (const n of [1, 2, 3, 4]) {
      const state = makeCoopState(n)
      state.elapsedMs = MILESTONE_ELAPSED.finalBoss!
      onlyMilestone(state, 'finalBoss')
      const boss = checkMilestoneSpawns(state, mulberry32(5)).bosses!.get('boss_unfinished_one')!
      expect(boss.hp).toBe(scaled.hp * n)
      expect(boss.maxHp).toBe(boss.hp)
      expect(boss.hp).toBeLessThanOrEqual(0xffffffff)
    }
    expect(scaled.hp * 4).toBe(320_000)
  })

  it('solo milestone hp is unscaled even with a bogus playerCount', () => {
    const state = makeInitialState(5)
    state.playerCount = 3
    state.elapsedMs = MILESTONE_ELAPSED.finalBoss!
    const next = checkMilestoneSpawns(state, mulberry32(5))
    expect(next.bosses!.get('boss_patient_zero')!.hp).toBe(3000)
    expect(next.bosses!.get('boss_unfinished_one')!.hp).toBe(
      scaleFinalBossStats(bossCatalog.unfinished_one!, 0).hp
    )
    const elites = [...next.enemies.values()].filter((e) => e.isElite)
    expect(elites).toHaveLength(4)
    for (const e of elites) {
      const entry = Object.values(eliteCatalog).find((c) => c.displayName === e.eliteName)!
      expect(e.hp).toBe(entry.hp)
    }
  })
})

// ─── Spawn anchor + solo prng identity (Pitfall 2) ───────────────────────────

describe('difficulty — spawn anchor and prng draw order (Pitfall 2)', () => {
  /**
   * Phase 5 reference implementation of a solo spawn position: archetype roll,
   * then angle roll, anchored on the first player. Asserted independently of
   * spawn.ts so any extra solo draw is caught.
   */
  function phase5SoloSpawn(state: PlainGameState, seed: number): { x: number; y: number } {
    const prng = mulberry32(seed)
    prng.next() // archetype roll
    const angle = prng.next() * 2 * Math.PI
    const p = [...state.players.values()][0]!
    const dx = Math.round(Math.cos(angle) * SPAWN_DIST)
    const dy = Math.round(Math.sin(angle) * SPAWN_DIST)
    return {
      x: (((p.x + dx) % WORLD_W) + WORLD_W) % WORLD_W,
      y: (((p.y + dy) % WORLD_H) + WORLD_H) % WORLD_H,
    }
  }

  it('solo spawn positions match the Phase 5 reference byte-for-byte', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const state = makeInitialState(seed)
      state.elapsedMs = 30_000
      const e = onlyEnemy(spawnEnemies(state, mulberry32(seed)))
      const ref = phase5SoloSpawn(state, seed)
      expect({ x: e.x, y: e.y }).toEqual(ref)
    }
  })

  it('solo spawnEnemies consumes exactly 2 draws; coop consumes exactly 3', () => {
    const solo = makeInitialState(1)
    const sp = countingPrng(1)
    onlyEnemy(spawnEnemies(solo, sp))
    expect(sp.calls()).toBe(2)

    for (const n of [1, 2, 4]) {
      const coop = makeCoopState(n)
      const cp = countingPrng(1)
      onlyEnemy(spawnEnemies(coop, cp))
      expect(cp.calls()).toBe(3)
    }
  })

  it('solo milestone spawn consumes 1 draw; coop consumes 2', () => {
    const solo = makeInitialState(1)
    solo.elapsedMs = MILESTONE_ELAPSED.elite1!
    onlyMilestone(solo, 'elite1')
    const sp = countingPrng(1)
    checkMilestoneSpawns(solo, sp)
    expect(sp.calls()).toBe(1)

    const coop = makeCoopState(3)
    coop.elapsedMs = MILESTONE_ELAPSED.elite1!
    onlyMilestone(coop, 'elite1')
    const cp = countingPrng(1)
    checkMilestoneSpawns(coop, cp)
    expect(cp.calls()).toBe(2)
  })

  it('coop anchor is deterministic: same seed + same state → same enemy', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const a = spawnEnemies(makeCoopState(4, seed), mulberry32(seed))
      const b = spawnEnemies(makeCoopState(4, seed), mulberry32(seed))
      expect(onlyEnemy(a)).toEqual(onlyEnemy(b))
    }
  })

  it('coop anchor is prng-selected among players: every player anchors for some seed', () => {
    const anchors = new Set<string>()
    for (let seed = 1; seed <= 200; seed++) {
      const state = makeCoopState(4, seed)
      const e = onlyEnemy(spawnEnemies(state, mulberry32(seed)))
      const a = anchorsOf(state, e.x, e.y)
      expect(a.length).toBeGreaterThanOrEqual(1)
      for (const id of a) anchors.add(id)
    }
    expect([...anchors].sort()).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it('eliminated players never anchor; downed players may', () => {
    const anchors = new Set<string>()
    for (let seed = 1; seed <= 200; seed++) {
      const state = makeCoopState(3, seed)
      const p1 = state.players.get('p1')! as PlainPlayerState
      p1.eliminated = true
      p1.hp = 0
      const p2 = state.players.get('p2')!
      p2.downed = true
      p2.hp = 0
      p2.bleedOutRemainingMs = 20_000
      const e = onlyEnemy(spawnEnemies(state, mulberry32(seed)))
      const a = anchorsOf(state, e.x, e.y)
      expect(a.some((id) => id === 'p2' || id === 'p3')).toBe(true)
      for (const id of a) anchors.add(id)
    }
    expect(anchors.has('p2')).toBe(true)
    expect(anchors.has('p3')).toBe(true)
    expect(anchors.has('p1')).toBe(false)
  })

  it('coop milestone anchor skips eliminated players too', () => {
    const anchors = new Set<string>()
    for (let seed = 1; seed <= 120; seed++) {
      const state = makeCoopState(3, seed)
      state.players.get('p3')!.eliminated = true
      state.elapsedMs = MILESTONE_ELAPSED.elite1!
      onlyMilestone(state, 'elite1')
      const next = checkMilestoneSpawns(state, mulberry32(seed))
      const elite = [...next.enemies.values()].find((e) => e.isElite)!
      for (const id of anchorsOf(state, elite.x, elite.y)) anchors.add(id)
    }
    expect(anchors.has('p3')).toBe(false)
    expect(anchors.has('p1')).toBe(true)
    expect(anchors.has('p2')).toBe(true)
  })
})
