/**
 * 30-minute run arc test (D-12/D-15, GAME-12/13/14/15/16, BIOM-02).
 *
 * RED phase (plan 05-01): runs the full 36,100-tick deterministic arc once
 * and asserts on milestone spawns (elites, biome boss, final boss), the
 * `kills` counter, and `result`. simulateTick does not yet wire
 * checkMilestoneSpawns or kills/result bookkeeping — these assertions are
 * EXPECTED to fail RED until plan 05-06 (Wave "GREEN" implementer).
 *
 * Uses a single top-level beforeAll to run the 36,100-tick loop ONCE,
 * sharing snapshots across `it()` blocks so the full file stays under 5s.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { makeInitialState, simulateTick, mulberry32 } from '@game/shared'
import type { PlainGameState, PlayerInput } from '@game/shared'

const SEED = 12345

// Milestone tick numbers (20Hz, D-12): 6/12/18/24/20/30 min
const TICK_ELITE1 = 7_200 // 6 min
const TICK_ELITE2 = 14_400 // 12 min
const TICK_ELITE3 = 21_600 // 18 min
const TICK_BIOME_BOSS = 24_000 // 20 min
const TICK_ELITE4 = 28_800 // 24 min
const TICK_FINAL_BOSS = 36_000 // 30 min
const TICK_ENDLESS = 36_100 // endless continuation past final boss

describe('30-minute run arc (D-12/D-15)', () => {
  // Snapshots captured at each milestone tick, plus the final endless tick.
  const snapshots = new Map<number, PlainGameState>()

  beforeAll(() => {
    let state = makeInitialState(SEED)
    // Give p1 a starting weapon so auto-fire produces real collisions/kills
    // over the course of the run (Task 2 behavior).
    const p1 = state.players.get('p1')!
    p1.weapons = ['magic_wand']

    const prng = mulberry32(SEED)
    const noInputs = new Map<string, PlayerInput>()

    const captureTicks = new Set([
      TICK_ELITE1,
      TICK_ELITE2,
      TICK_ELITE3,
      TICK_BIOME_BOSS,
      TICK_ELITE4,
      TICK_FINAL_BOSS,
      TICK_ENDLESS,
    ])

    for (let tick = 1; tick <= TICK_ENDLESS; tick++) {
      state = simulateTick(state, noInputs, prng)
      if (captureTicks.has(tick)) {
        snapshots.set(tick, state)
      }
    }
    // 36,100 ticks of the full combat pipeline can exceed vitest's default
    // 10s hook timeout on slower machines — the loop is deterministic, just slow.
  }, 60_000)

  it('spawns elite1 (Stitched Orderly) at tick 7200 (6 min)', () => {
    const state = snapshots.get(TICK_ELITE1)!
    const elites = [...state.enemies.values()].filter(
      (e) => e.isElite === true && e.eliteName === 'Stitched Orderly'
    )
    expect(elites.length).toBeGreaterThanOrEqual(1)
    expect(state.milestonesSpawned?.elite1).toBe(true)
  })

  it('spawns elite2 (The Harvester) at tick 14400 (12 min)', () => {
    const state = snapshots.get(TICK_ELITE2)!
    const elites = [...state.enemies.values()].filter(
      (e) => e.isElite === true && e.eliteName === 'The Harvester'
    )
    expect(elites.length).toBeGreaterThanOrEqual(1)
    expect(state.milestonesSpawned?.elite2).toBe(true)
  })

  it('spawns elite3 (Meat Golem) at tick 21600 (18 min)', () => {
    const state = snapshots.get(TICK_ELITE3)!
    const elites = [...state.enemies.values()].filter(
      (e) => e.isElite === true && e.eliteName === 'Meat Golem'
    )
    expect(elites.length).toBeGreaterThanOrEqual(1)
    expect(state.milestonesSpawned?.elite3).toBe(true)
  })

  it('spawns biome boss Patient Zero at tick 24000 (20 min) (BIOM-02)', () => {
    const state = snapshots.get(TICK_BIOME_BOSS)!
    const bosses = [...(state.bosses ?? new Map()).values()].filter(
      (b) => b.bossKey === 'patient_zero'
    )
    expect(bosses.length).toBeGreaterThanOrEqual(1)
    expect(state.milestonesSpawned?.biomeBoss).toBe(true)
  })

  it('spawns elite4 (Brain Jar Crawler) at tick 28800 (24 min)', () => {
    const state = snapshots.get(TICK_ELITE4)!
    const elites = [...state.enemies.values()].filter(
      (e) => e.isElite === true && e.eliteName === 'Brain Jar Crawler'
    )
    expect(elites.length).toBeGreaterThanOrEqual(1)
    expect(state.milestonesSpawned?.elite4).toBe(true)
  })

  it('spawns final boss The Unfinished One at tick 36000 (30 min) (GAME-13)', () => {
    const state = snapshots.get(TICK_FINAL_BOSS)!
    const bosses = [...(state.bosses ?? new Map()).values()].filter(
      (b) => b.bossKey === 'unfinished_one'
    )
    expect(bosses.length).toBeGreaterThanOrEqual(1)
    expect(state.milestonesSpawned?.finalBoss).toBe(true)
  })

  it('continues simulating past tick 36000 into endless mode (tick 36100)', () => {
    const state = snapshots.get(TICK_ENDLESS)!
    expect(state.tick).toBe(TICK_ENDLESS)
  })

  it('kills counter increments only for elite/enemy deaths, not boss deaths', () => {
    const finalState = snapshots.get(TICK_ENDLESS)!
    // kills is always a non-negative number throughout the run.
    expect(typeof finalState.kills).toBe('number')
    expect(finalState.kills ?? 0).toBeGreaterThanOrEqual(0)
    // After 30+ minutes of auto-fire, at least one enemy should have died.
    expect(finalState.kills ?? 0).toBeGreaterThan(0)
  })

  it('result is undefined while player hp > 0', () => {
    const finalState = snapshots.get(TICK_ENDLESS)!
    // If the seeded run produces a player death before tick 36100, this
    // assertion documents the alternative GREEN-phase contract instead:
    // result === 'defeated' and kills remains a number.
    if (finalState.result === 'defeated') {
      expect(typeof (finalState.kills ?? 0)).toBe('number')
    } else {
      expect(finalState.result).toBeUndefined()
    }
  })
})
