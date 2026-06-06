/**
 * simulateTick movement tests (GAME-02)
 *
 * Verifies consistent player speed across all 8 movement directions.
 * World uses integer sub-units: 1000 sub-units per game unit (D-06/RESEARCH OQ-4).
 * Player speed = 200 game-units/sec = 200,000 sub-units/sec.
 * At 20Hz (50ms/tick): 10,000 sub-units displacement per tick at full speed.
 *
 * Acceptable range [9900, 10100] allows for integer rounding in sub-unit arithmetic.
 *
 * RED phase: all tests fail with 'not implemented'.
 * GREEN phase: plan 03-02 implements simulateTick with movement logic.
 */
import { describe, it, expect } from 'vitest'
import { simulateTick, makeInitialState, mulberry32 } from '@game/shared'
import type { PlayerInput } from '@game/shared'

// World size: 4096 game-units → 4,096,000 sub-units. Center = 2,048,000.
const CENTER = 2_048_000

// Expected displacement per tick at full speed (10,000 sub-units)
const EXPECTED_DISPLACEMENT = 10_000
const TOLERANCE = 100

function magnitude(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy)
}

// Build a minimal PlayerInput for direction testing
function makeInput(mx: number, my: number): PlayerInput {
  return {
    moveVector: { x: mx, y: my },
    aimAngle: 0,
    actionFlags: 0,
    seq: 0,
    tick: 0,
  }
}

describe('simulateTick movement (GAME-02) — 8-direction equal speed', () => {
  const SQRT2_HALF = 1 / Math.sqrt(2)

  const directions: Array<{ name: string; mx: number; my: number }> = [
    { name: 'North (up)', mx: 0, my: -1 },
    { name: 'NorthEast', mx: SQRT2_HALF, my: -SQRT2_HALF },
    { name: 'East (right)', mx: 1, my: 0 },
    { name: 'SouthEast', mx: SQRT2_HALF, my: SQRT2_HALF },
    { name: 'South (down)', mx: 0, my: 1 },
    { name: 'SouthWest', mx: -SQRT2_HALF, my: SQRT2_HALF },
    { name: 'West (left)', mx: -1, my: 0 },
    { name: 'NorthWest', mx: -SQRT2_HALF, my: -SQRT2_HALF },
  ]

  for (const { name, mx, my } of directions) {
    it(`player moves at consistent speed: ${name}`, () => {
      const state = makeInitialState(1)
      // Place the single player at world center
      const [playerId] = [...state.players.keys()]
      const player = state.players.get(playerId)!
      player.x = CENTER
      player.y = CENTER

      const inputs = new Map([[playerId, makeInput(mx, my)]])
      const prng = mulberry32(1)

      const nextState = simulateTick(state, inputs, prng)

      const nextPlayer = nextState.players.get(playerId)!
      const dx = nextPlayer.x - CENTER
      const dy = nextPlayer.y - CENTER
      const dist = magnitude(dx, dy)

      expect(dist).toBeGreaterThanOrEqual(EXPECTED_DISPLACEMENT - TOLERANCE)
      expect(dist).toBeLessThanOrEqual(EXPECTED_DISPLACEMENT + TOLERANCE)
    })
  }
})
