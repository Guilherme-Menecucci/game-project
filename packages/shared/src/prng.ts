/**
 * mulberry32 — fast seeded PRNG returning values in [0, 1).
 *
 * CRITICAL: NEVER call Math.random() anywhere in simulation code.
 * All randomness must flow through this PRNG for SC-2 determinism.
 *
 * Pattern 9 from 03-RESEARCH.md.
 */

export type Prng = {
  next: () => number
  state: () => number
}

/**
 * Create a mulberry32 PRNG from the given uint32 seed.
 * next() advances the state and returns a float in [0, 1).
 * state() returns the current internal state for PRNG restore.
 */
export function mulberry32(seed: number): Prng {
  // Internal mutable state — uint32
  let s = seed >>> 0

  return {
    next(): number {
      s += 0x6d2b79f5
      let z = s
      z = (z ^ (z >>> 15)) * (z | 1)
      z ^= z + (z ^ (z >>> 7)) * (z | 61)
      return ((z ^ (z >>> 14)) >>> 0) / 0x100000000
    },
    state(): number {
      return s >>> 0
    },
  }
}
