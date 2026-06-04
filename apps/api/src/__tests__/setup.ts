/**
 * Vitest global test setup — loads .env before any test modules are imported.
 * This ensures env.ts Zod validation succeeds during test runs.
 * The .env file is gitignored and holds local dev credentials.
 */
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// .env is at apps/api/.env — navigate up from src/__tests__/
const envPath = resolve(__dirname, '../../.env')

// Always set NODE_ENV=test so Fastify disables its logger during test runs
process.env['NODE_ENV'] = 'test'

try {
  const content = readFileSync(envPath, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    // Always set from .env to ensure our values win over Vite's reserved env vars
    // (e.g. Vite injects BASE_URL='/' which conflicts with our APP_BASE_URL use).
    // CI can override specific vars by setting them before the test process starts
    // using VITEST_ENV_<KEY> or by using a CI-specific .env.
    process.env[key] = value
  }
} catch {
  // .env not found — rely on process.env (CI sets real env vars)
}

// Re-apply NODE_ENV=test after .env loading (in case .env sets NODE_ENV=development)
process.env['NODE_ENV'] = 'test'
