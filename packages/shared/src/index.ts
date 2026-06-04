// @game/shared — Phase 1 public API
// Phase 3 will expand PlayerInputSchema with seq and tick fields.
// Use z.object (not z.tuple) to allow adding fields without breaking the import contract.
import * as z from 'zod'

export const PlayerInputSchema = z.object({
  moveVector: z.object({
    x: z.number(),
    y: z.number(),
  }),
  aimAngle: z.number(),
  actionFlags: z.number().int(),
})

export type PlayerInput = z.infer<typeof PlayerInputSchema>

// Auth schemas (Phase 2)
export const LoginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
})
export type Login = z.infer<typeof LoginSchema>

export const RegisterSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(72),
})
export type Register = z.infer<typeof RegisterSchema>

export const GuestTokenResponseSchema = z.object({
  userId: z.uuid(),
  isGuest: z.literal(true),
  displayName: z.string(),
})
export type GuestTokenResponse = z.infer<typeof GuestTokenResponseSchema>
