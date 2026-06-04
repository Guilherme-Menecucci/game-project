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
  },
})
