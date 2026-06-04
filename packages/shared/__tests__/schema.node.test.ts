import { describe, it, expect } from 'vitest'
import { PlayerInputSchema } from '@game/shared'
import type { PlayerInput } from '@game/shared'

describe('PlayerInputSchema — Node environment', () => {
  it('validates a valid player input', () => {
    const result = PlayerInputSchema.safeParse({
      moveVector: { x: 1, y: 0 },
      aimAngle: 0.5,
      actionFlags: 0,
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing fields', () => {
    const result = PlayerInputSchema.safeParse({ invalid: true })
    expect(result.success).toBe(false)
  })

  it('rejects non-integer actionFlags', () => {
    const result = PlayerInputSchema.safeParse({
      moveVector: { x: 1, y: 0 },
      aimAngle: 0.5,
      actionFlags: 1.5,
    })
    expect(result.success).toBe(false)
  })

  it('PlayerInput type is exported (compile-time check)', () => {
    const input: PlayerInput = {
      moveVector: { x: 0, y: -1 },
      aimAngle: Math.PI,
      actionFlags: 1,
    }
    expect(typeof input).toBe('object')
  })
})
