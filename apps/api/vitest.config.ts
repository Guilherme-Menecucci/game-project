import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    conditions: ['source'],
  },
  // In Vite 6+, node-environment tests use ssr.resolve.conditions (not resolve.conditions).
  // Both must be set so that both jsdom (browser/client env) and node env tests resolve
  // '@game/shared' via the "source" export condition pointing to ./src/index.ts.
  ssr: {
    resolve: {
      conditions: ['source'],
    },
  },
  test: {
    environment: 'node',
    // setupFiles runs before any test file is imported, loading .env into process.env
    // so env.ts Zod validation succeeds. The .env file is gitignored.
    setupFiles: ['./src/__tests__/setup.ts'],
    // Run test files sequentially — required for DB-touching tests that share gamedev_test.
    // Parallel execution causes DELETE FROM accounts in one file to wipe accounts created
    // by concurrent files' beforeEach hooks, causing intermittent 401/404 failures.
    fileParallelism: false,
  },
})
