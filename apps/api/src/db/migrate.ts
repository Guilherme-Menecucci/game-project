/**
 * Standalone one-shot migration runner.
 *
 * NOT called on application startup — run this as a separate step in CI/deployment.
 * Anti-pattern: blocking migration on app startup fails if the DB is not ready.
 *
 * Usage:
 *   pnpm --filter=@game/api generate   # generate migration SQL files
 *   pnpm --filter=@game/api migrate    # apply migrations (via drizzle-kit migrate)
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { sql, db } from './client.js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(__dirname, '../../drizzle')

async function runMigrations(): Promise<void> {
  console.log('Running migrations from:', migrationsFolder)
  await migrate(db, { migrationsFolder })
  console.log('Migrations applied successfully')
  await sql.end()
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
