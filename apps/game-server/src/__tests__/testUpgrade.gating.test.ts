/**
 * test_upgrade backdoor gating tests (Phase 6 Wave 0, T-06-02 / Pitfall 8).
 *
 * The old gate was `process.env['NODE_ENV'] !== 'production'` — a DENY-list
 * that treats a misconfigured or unset deployment as dev and opens the
 * backdoor. The fix is an ALLOW-list: isDevEnv returns true only for exactly
 * 'development' or 'test'; everything else (unset, empty, production,
 * staging, case variants) is denied.
 *
 * Under vitest NODE_ENV is 'test', so existing level-up tests that lean on
 * test_upgrade keep working unchanged.
 */
import { describe, it, expect } from 'vitest'
import { isDevEnv } from '../lib/env.js'

describe('isDevEnv allowlist gating (T-06-02, Pitfall 8)', () => {
  it("returns true for 'development'", () => {
    expect(isDevEnv('development')).toBe(true)
  })

  it("returns true for 'test'", () => {
    expect(isDevEnv('test')).toBe(true)
  })

  it('returns false for undefined (unset NODE_ENV must deny the backdoor)', () => {
    expect(isDevEnv(undefined)).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isDevEnv('')).toBe(false)
  })

  it("returns false for 'production'", () => {
    expect(isDevEnv('production')).toBe(false)
  })

  it("returns false for 'staging'", () => {
    expect(isDevEnv('staging')).toBe(false)
  })

  it("returns false for 'Production' (exact match only — no case folding)", () => {
    expect(isDevEnv('Production')).toBe(false)
  })
})
