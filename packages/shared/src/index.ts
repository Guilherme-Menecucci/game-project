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
