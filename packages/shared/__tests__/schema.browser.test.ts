// @vitest-environment jsdom
//
// CRITICAL: This test imports from '@game/shared' (package name), NOT from '../src/index'.
// A relative import would always resolve and would NOT verify that Vitest's resolve.conditions
// + package.json exports wiring is correct. The package-name import exercises the
// non-retrofittable crux: if '@game/shared' resolves here, downstream packages will too.
import { describe, it, expect } from 'vitest'
import { PlayerInputSchema } from '@game/shared'

describe('PlayerInputSchema — jsdom (browser context)', () => {
  it('validates a valid player input in jsdom environment', () => {
    const result = PlayerInputSchema.safeParse({
      moveVector: { x: 1, y: 0 },
      aimAngle: 0,
      actionFlags: 0,
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid input in jsdom environment', () => {
    const result = PlayerInputSchema.safeParse({ invalid: true })
    expect(result.success).toBe(false)
  })
})
