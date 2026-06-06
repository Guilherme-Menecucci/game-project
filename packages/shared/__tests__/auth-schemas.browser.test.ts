// @vitest-environment jsdom
//
// CRITICAL: This test imports from '@game/shared' (package name), NOT from '../src/index'.
// A relative import would always resolve and would NOT verify that Vitest's resolve.conditions
// + package.json exports wiring is correct. The package-name import exercises the
// non-retrofittable crux: if '@game/shared' resolves here, downstream packages will too.
import { describe, it, expect } from 'vitest'
import { LoginSchema, RegisterSchema, GuestTokenResponseSchema } from '@game/shared'

describe('Auth schemas — jsdom (browser context)', () => {
  it('LoginSchema validates a valid input in jsdom environment', () => {
    const result = LoginSchema.safeParse({
      email: 'user@example.com',
      password: 'password123',
    })
    expect(result.success).toBe(true)
  })

  it('LoginSchema rejects invalid input in jsdom environment', () => {
    const result = LoginSchema.safeParse({ invalid: true })
    expect(result.success).toBe(false)
  })

  it('RegisterSchema validates a valid input in jsdom environment', () => {
    const result = RegisterSchema.safeParse({
      email: 'user@example.com',
      password: 'validpass1',
    })
    expect(result.success).toBe(true)
  })

  it('GuestTokenResponseSchema validates a valid input in jsdom environment', () => {
    const result = GuestTokenResponseSchema.safeParse({
      userId: '550e8400-e29b-41d4-a716-446655440000',
      isGuest: true,
      displayName: 'Guest_4f2a',
    })
    expect(result.success).toBe(true)
  })
})
