/**
 * spawnEnemies spawn curve tests (GAME-04, GAME-05)
 *
 * Verifies:
 * 1. Spawn interval decreases with elapsed time per formula: max(300, 2000 - elapsed*0.02)
 * 2. Only swarmers spawn before 60 seconds
 * 3. Tank and ranged enemies appear after 60 seconds
 * 4. Max-alive cap (300 enemies) prevents additional spawns
 *
 * RED phase: all tests fail with 'not implemented'.
 * GREEN phase: plan 03-03 implements spawnEnemies.
 */
import { describe, it, expect } from 'vitest'
import { spawnEnemies, makeInitialState, mulberry32 } from '@game/shared'
import type { PlainGameState } from '@game/shared'

// Spawn curve constants (RESEARCH spec)
const BASE_SPAWN_INTERVAL_MS = 2000
const MIN_SPAWN_INTERVAL_MS = 300
const DIFFICULTY_RAMP = 0.02 // ms reduction per ms elapsed
const MAX_ENEMIES_CAP = 300

function expectedInterval(elapsedMs: number): number {
  return Math.max(MIN_SPAWN_INTERVAL_MS, BASE_SPAWN_INTERVAL_MS - elapsedMs * DIFFICULTY_RAMP)
}

// Helper: advance state elapsedMs without calling simulateTick
function stateAtTime(elapsedMs: number): PlainGameState {
  const state = makeInitialState(1)
  state.elapsedMs = elapsedMs
  return state
}

describe('spawnEnemies (GAME-04, GAME-05)', () => {
  it('spawn interval decreases with elapsed time', () => {
    // At t=0: interval = max(300, 2000 - 0) = 2000ms
    const earlyInterval = expectedInterval(0)
    expect(earlyInterval).toBe(BASE_SPAWN_INTERVAL_MS)

    // At t=50000ms (50s): interval = max(300, 2000 - 1000) = 1000ms
    const midInterval = expectedInterval(50_000)
    expect(midInterval).toBe(1000)

    // At t=200000ms (200s): interval = max(300, 2000 - 4000) = 300ms (floor)
    const lateInterval = expectedInterval(200_000)
    expect(lateInterval).toBe(MIN_SPAWN_INTERVAL_MS)

    // Verify spawnEnemies respects the interval: at t=0 with tick=1 (50ms),
    // no spawn should occur yet (first spawn at 2000ms)
    const state = stateAtTime(0)
    state.tick = 1 // 50ms elapsed since last spawn check
    const prng = mulberry32(1)
    const next = spawnEnemies(state, prng)
    // No enemies should be spawned at 50ms (interval is 2000ms)
    expect(next.enemies.size).toBe(0)
  })

  it('archetype mix: only swarmers before 60 seconds', () => {
    const state = stateAtTime(30_000) // 30s
    const prng = mulberry32(42)

    // Call spawnEnemies enough times to collect multiple spawns
    let currentState = state
    for (let i = 0; i < 100; i++) {
      currentState = spawnEnemies(currentState, prng)
    }

    // All spawned enemies should be swarmers
    for (const enemy of currentState.enemies.values()) {
      expect(enemy.archetype).toBe('swarmer')
    }
  })

  it('archetype mix: tank and ranged appear after 60 seconds', () => {
    const state = stateAtTime(90_000) // 90s
    const prng = mulberry32(42)

    // Collect archetypes over many spawn calls
    const archetypes = new Set<string>()
    let currentState = state
    for (let i = 0; i < 100; i++) {
      currentState = spawnEnemies(currentState, prng)
      for (const enemy of currentState.enemies.values()) {
        archetypes.add(enemy.archetype)
      }
    }

    expect(archetypes).toContain('tank')
    expect(archetypes).toContain('ranged')
  })

  it('max-alive cap: no spawn when enemies.size >= cap', () => {
    const state = stateAtTime(60_000)
    // Fill enemies up to the cap
    for (let i = 0; i < MAX_ENEMIES_CAP; i++) {
      state.enemies.set(`e${i}`, {
        id: `e${i}`,
        x: 0,
        y: 0,
        hp: 10,
        maxHp: 10,
        archetype: 'swarmer',
        speed: 100_000,
        lastFireTick: 0,
      })
    }
    expect(state.enemies.size).toBe(MAX_ENEMIES_CAP)

    const prng = mulberry32(1)
    const next = spawnEnemies(state, prng)

    // No additional enemies should have been added
    expect(next.enemies.size).toBe(MAX_ENEMIES_CAP)
  })
})
