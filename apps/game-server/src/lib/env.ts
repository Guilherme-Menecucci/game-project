/**
 * Zod-validated environment schema for the game server.
 *
 * IMPORTANT: This module throws at import time if the environment is invalid.
 * No .env file loading — game-server receives env vars from shell/Docker Compose.
 * In tests, src/__tests__/setup.ts sets JWT_SECRET before this module imports.
 */
import * as z from 'zod'

const envSchema = z.object({
  JWT_SECRET: z.string().min(32),
  PORT: z.string().optional().default('2567'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const missingFields = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
  throw new Error(`Environment validation failed. Missing or invalid fields: ${missingFields}`)
}

export const env = parsed.data
