import { readdirSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import { join } from 'path'
import Fastify, { type FastifyInstance } from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import { registerCookie } from './plugins/cookie.js'
import { registerJwt } from './plugins/jwt.js'
import { registerRateLimit } from './plugins/rate-limit.js'
import { redis } from './services/redis.js'
import { env } from './env.js'

/**
 * Build and configure the Fastify application.
 *
 * Returns a configured FastifyInstance WITHOUT calling .listen().
 * Tests call buildApp() → app.ready() → app.inject() → app.close().
 * Production calls start() which calls buildApp() then .listen().
 *
 * Route autoload design: dynamically loads all .js files in routes/auth/ at startup.
 * Wave 2 plans (02-03, 02-04, 02-05) only need to CREATE files in routes/auth/ —
 * no central barrel file to edit. Each route file exports a default function:
 *   (app: FastifyInstance) => Promise<void>
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.NODE_ENV !== 'test',
  })

  // Plugin registration order is critical (Pattern H):
  // 0. helmet + cors FIRST — HTTP-layer hardening applies to every response
  //    before any auth machinery runs (Phase 6 Wave 0, T-06-03 mitigate)
  // 1. cookie — decorates request.cookies
  // 2. jwt AFTER — reads from request.cookies['session']
  // 3. rate-limit AFTER
  // helmet defaults are safe for a JSON-only API (Pitfall 6).
  await app.register(helmet)
  // origin MUST be the array form: a static string would echo the configured
  // origin on EVERY response (see @fastify/cors getAccessControlAllowOriginHeader);
  // the array form reflects the origin only when it matches — disallowed origins
  // get no Access-Control-Allow-Origin header at all.
  // credentials: true is required for the HttpOnly session cookie flow.
  await app.register(cors, { origin: [env.CORS_ORIGIN], credentials: true })
  await registerCookie(app)
  await registerJwt(app)
  await registerRateLimit(app, redis)

  // Autoload route files from routes/auth/*.js
  // ENOENT guard: if the directory doesn't exist yet (e.g. during Wave 2 RED tests
  // before any route files have been created), treat as empty array.
  const routeDir = fileURLToPath(new URL('./routes/auth/', import.meta.url))
  let routeFiles: string[]
  try {
    // Accept both .ts (vitest/dev) and .js (production/compiled) — exclude .d.ts declarations
    routeFiles = readdirSync(routeDir).filter(
      (f) => (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts')
    )
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      // Directory doesn't exist yet — no routes to load (safe for Wave 2 RED tests)
      routeFiles = []
    } else {
      throw err
    }
  }

  for (const file of routeFiles) {
    const fileUrl = pathToFileURL(join(routeDir, file)).href
    const mod = await import(fileUrl)
    await (mod.default as (app: FastifyInstance) => Promise<void>)(app)
  }

  // Health check route
  app.get('/health', async () => {
    return { status: 'ok' }
  })

  return app
}

async function start(): Promise<void> {
  const app = await buildApp()
  // Fastify v5: .listen() requires object syntax (not variadic port, host args)
  await app.listen({ port: 3000, host: '0.0.0.0' })
}

// Main module guard — only start the server when this file is the entry point
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
