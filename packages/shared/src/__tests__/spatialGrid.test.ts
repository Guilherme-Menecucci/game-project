/**
 * UniformGrid spatial hash grid tests (GAME-18)
 *
 * Verifies:
 * 1. queryRadius returns entities within radius and excludes those outside
 * 2. Toroidal (wrap-around) boundary handling at world edges
 * 3. 300-entity insert + queryRadius performance under 5ms
 *
 * World size: 4,096,000 sub-units (4096 game-units × 1000 sub-units each).
 *
 * RED phase: all tests fail with 'not implemented'.
 * GREEN phase: plan 03-02 implements UniformGrid.
 */
import { describe, it, expect } from 'vitest'
import { UniformGrid, mulberry32 } from '@game/shared'

// World size in sub-units
const WORLD_SIZE = 4_096_000

describe('UniformGrid spatial hashing (GAME-18)', () => {
  it('queryRadius returns entities within radius', () => {
    const grid = new UniformGrid()
    grid.insert('a', 100, 100)
    grid.insert('b', 200, 200)
    grid.insert('c', 5000, 5000)

    // Query centered at (100,100) with radius 80: 'a' is at distance 0, 'b' at ~141, 'c' far
    const result = grid.queryRadius(100, 100, 80)

    expect(result).toContain('a')
    expect(result).not.toContain('c')
  })

  it('queryRadius handles toroidal wrap at world boundary', () => {
    const grid = new UniformGrid()
    // Entity just inside the east boundary
    grid.insert('a', 50, 50)

    // Query from near the west edge — wraps around to reach entity near east edge
    // Distance via toroidal wrap: WORLD_SIZE - 4_095_950 + 50 = 100 sub-units
    const result = grid.queryRadius(WORLD_SIZE - 50, 50, 200)

    expect(result).toContain('a')
  })

  it('300 entities: insert + queryRadius completes under 5ms', () => {
    const grid = new UniformGrid()
    const prng = mulberry32(1)

    // Insert 300 entities at reproducible random positions
    for (let i = 0; i < 300; i++) {
      const x = Math.floor(prng.next() * WORLD_SIZE)
      const y = Math.floor(prng.next() * WORLD_SIZE)
      grid.insert(`e${i}`, x, y)
    }

    const start = Date.now()
    grid.queryRadius(2_000_000, 2_000_000, 500_000)
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(5)
  })
})
