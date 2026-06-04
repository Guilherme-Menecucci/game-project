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
