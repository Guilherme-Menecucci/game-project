/**
 * Vitest global test setup for apps/game-server.
 *
 * Minimal setup: only JWT_SECRET is required.
 * No .env file loading — game-server receives env vars directly in CI.
 * No Redis flush — game-server does not use Redis in its test suite.
 */

process.env['NODE_ENV'] = 'test'

if (!process.env['JWT_SECRET']) {
  process.env['JWT_SECRET'] = 'test-secret-at-least-32-characters-long-here'
}
