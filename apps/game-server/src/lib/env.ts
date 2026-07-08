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
  // No default on purpose: unset must STAY unset so the isDevEnv allowlist
  // denies it (Pitfall 8 — defaulting to 'development' would open backdoors
  // on misconfigured deployments).
  NODE_ENV: z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const missingFields = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
  throw new Error(`Environment validation failed. Missing or invalid fields: ${missingFields}`)
}

export const env = parsed.data

/**
 * Allowlist dev-environment check (T-06-02, Pitfall 8).
 *
 * The old gate `process.env['NODE_ENV'] !== 'production'` is a deny-list: a
 * misconfigured or UNSET deployment is treated as dev and opens debug
 * backdoors (test_upgrade). This allowlist returns true only for exactly
 * 'development' or 'test' — unset, empty, 'production', 'staging', and case
 * variants are all denied.
 */
export function isDevEnv(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'development' || nodeEnv === 'test'
}
