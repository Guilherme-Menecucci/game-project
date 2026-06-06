/**
 * mulberry32 PRNG tests
 *
 * Verifies:
 * 1. Same seed produces identical output sequence (deterministic)
 * 2. All outputs are in the range [0, 1)
 * 3. State can be saved and restored for mid-sequence replay
 *
 * RED phase: all tests fail with 'not implemented'.
 * GREEN phase: plan 03-02 implements mulberry32.
 */
import { describe, it, expect } from 'vitest'
import { mulberry32 } from '@game/shared'

describe('mulberry32 PRNG', () => {
  it('same seed produces identical sequence', () => {
    const prng1 = mulberry32(42)
    const prng2 = mulberry32(42)

    for (let i = 0; i < 10; i++) {
      expect(prng1.next()).toBe(prng2.next())
    }
  })

  it('all outputs are in [0, 1)', () => {
    const prng = mulberry32(12345)
    for (let i = 0; i < 1000; i++) {
      const val = prng.next()
      expect(val).toBeGreaterThanOrEqual(0)
      expect(val).toBeLessThan(1)
    }
  })

  it('state() returns restorable seed for mid-sequence replay', () => {
    const prng = mulberry32(42)

    // Advance 5 steps
    for (let i = 0; i < 5; i++) {
      prng.next()
    }

    // Save state after step 5
    const savedState = prng.state()

    // Collect next 5 values from original prng (steps 6-10)
    const originalValues: number[] = []
    for (let i = 0; i < 5; i++) {
      originalValues.push(prng.next())
    }

    // Restore prng from saved state
    const prng2 = mulberry32(savedState)

    // First 5 values from prng2 should match original steps 6-10
    for (let i = 0; i < 5; i++) {
      expect(prng2.next()).toBe(originalValues[i])
    }
  })
})
