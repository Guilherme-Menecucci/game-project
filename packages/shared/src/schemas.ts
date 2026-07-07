/**
 * Game input and auth schemas — shared Zod validators.
 * Separated from index.ts so game simulation files can import
 * PlayerInputSchema without creating a circular dependency.
 */
import * as z from 'zod'

// Game input schemas (Phase 1)
export const PlayerInputSchema = z.object({
  // .finite() rejects NaN/±Infinity. Bare z.number() accepts Infinity, which
  // flows into simulateTick normalization (vx = dx*speed/mag) → NaN → permanent
  // NaN player position. msgpack preserves non-finite floats on the wire, so a
  // malicious client can reach this path; reject it at the schema boundary.
  moveVector: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  aimAngle: z.number().finite(),
  actionFlags: z.number().int(),
  // D-02: Anti-replay sequence number — monotone per client connection.
  // Optional in Phase 3 for backward compat; will be required in Phase 4.
  seq: z.number().int().min(0).optional(),
  // D-02: Server tick reference — ties input snapshot to the authoritative tick.
  // Optional in Phase 3 for backward compat; will be required in Phase 4.
  tick: z.number().int().min(0).optional(),
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

// Phase 4 Schemas
export const UpgradeSelectedSchema = z.object({
  upgradeId: z.string(),
})
export type UpgradeSelected = z.infer<typeof UpgradeSelectedSchema>

export const ReplaceSlotSchema = z.object({
  slot: z.number().int().min(0).max(5),
  upgradeId: z.string(),
})
export type ReplaceSlot = z.infer<typeof ReplaceSlotSchema>

// Phase 5 Schemas
// CHAR-01/02/03: validates the character_select onJoin option. Server
// defaults to classId:'human', weaponId:'magic_wand' on safeParse failure
// (enforced in a later wave's SoloRoom plan) — T-05-00 mitigation.
export const CharacterSelectSchema = z.object({
  classId: z.enum(['vampire', 'human', 'dwarf']),
  weaponId: z.enum(['magic_wand', 'garlic', 'knife', 'bible']),
})
export type CharacterSelect = z.infer<typeof CharacterSelectSchema>
