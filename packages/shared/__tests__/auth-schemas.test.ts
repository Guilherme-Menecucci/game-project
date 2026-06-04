import { describe, it, expect } from 'vitest'
import { LoginSchema, RegisterSchema, GuestTokenResponseSchema } from '@game/shared'
import type { Login, Register, GuestTokenResponse } from '@game/shared'

describe('LoginSchema — Node environment', () => {
  it('accepts a valid email and password', () => {
    const result = LoginSchema.safeParse({
      email: 'user@example.com',
      password: 'password123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid email format', () => {
    const result = LoginSchema.safeParse({
      email: 'not-an-email',
      password: 'password123',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a password shorter than 8 characters', () => {
    const result = LoginSchema.safeParse({
      email: 'user@example.com',
      password: 'short',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a missing email field', () => {
    const result = LoginSchema.safeParse({ password: 'password123' })
    expect(result.success).toBe(false)
  })

  it('Login type is exported (compile-time check)', () => {
    const input: Login = { email: 'user@example.com', password: 'password123' }
    expect(typeof input).toBe('object')
  })
})

describe('RegisterSchema — Node environment', () => {
  it('accepts a valid email and password', () => {
    const result = RegisterSchema.safeParse({
      email: 'user@example.com',
      password: 'validpass1',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a password exactly 72 characters long (bcrypt boundary)', () => {
    const password72 = 'a'.repeat(72)
    const result = RegisterSchema.safeParse({
      email: 'user@example.com',
      password: password72,
    })
    expect(result.success).toBe(true)
  })

  it('rejects a password of 73 characters (bcrypt truncation guard)', () => {
    const password73 = 'a'.repeat(73)
    const result = RegisterSchema.safeParse({
      email: 'user@example.com',
      password: password73,
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid email format', () => {
    const result = RegisterSchema.safeParse({
      email: 'bad',
      password: 'password123',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a missing password field', () => {
    const result = RegisterSchema.safeParse({ email: 'user@example.com' })
    expect(result.success).toBe(false)
  })

  it('Register type is exported (compile-time check)', () => {
    const input: Register = { email: 'user@example.com', password: 'validpass1' }
    expect(typeof input).toBe('object')
  })
})

describe('GuestTokenResponseSchema — Node environment', () => {
  it('accepts a valid guest token response', () => {
    const result = GuestTokenResponseSchema.safeParse({
      userId: '550e8400-e29b-41d4-a716-446655440000',
      isGuest: true,
      displayName: 'Guest_4f2a',
    })
    expect(result.success).toBe(true)
  })

  it('rejects isGuest: false (literal true enforced)', () => {
    const result = GuestTokenResponseSchema.safeParse({
      userId: '550e8400-e29b-41d4-a716-446655440000',
      isGuest: false,
      displayName: 'Guest_4f2a',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a missing displayName field', () => {
    const result = GuestTokenResponseSchema.safeParse({
      userId: '550e8400-e29b-41d4-a716-446655440000',
      isGuest: true,
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid UUID format for userId', () => {
    const result = GuestTokenResponseSchema.safeParse({
      userId: 'not-a-uuid',
      isGuest: true,
      displayName: 'Guest_4f2a',
    })
    expect(result.success).toBe(false)
  })

  it('GuestTokenResponse type is exported (compile-time check)', () => {
    const input: GuestTokenResponse = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      isGuest: true,
      displayName: 'Guest_4f2a',
    }
    expect(typeof input).toBe('object')
  })
})
