/**
 * Phase 5 Wave 0 throwing stubs.
 *
 * These placeholders let Wave 0 RED test files (created in plan 05-01) import
 * `characterCatalog`, `eliteCatalog`, `bossCatalog`, `MILESTONE_MS`,
 * `scaleFinalBossStats`, and `checkMilestoneSpawns` from `@game/shared` and
 * resolve at COMPILE TIME, while failing at ASSERTION/CALL time (RED) until
 * Wave 1 (plan 05-02) replaces these with real implementations.
 *
 * The catalogs are empty objects (not throwing getters) so that
 * `characterCatalog['vampire']` safely evaluates to `undefined` — Wave 0
 * tests assert these entries are NOT undefined and thus fail RED for the
 * correct reason (missing catalog entry), not a module-load crash that would
 * hide other passing tests in the same file.
 *
 * Wave 1 (05-02) deletes this file and replaces the barrel re-export below
 * with the real `export * from './characterCatalog.js'` etc.
 */

// ─── Catalogs (empty — Wave 1 populates) ───────────────────────────────────

export const characterCatalog: Record<string, never> = {}
export const eliteCatalog: Record<string, never> = {}
export const bossCatalog: Record<string, never> = {}
export const MILESTONE_MS: Record<string, never> = {}

// ─── Functions (throw — Wave 1 implements) ─────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function scaleFinalBossStats(...args: unknown[]): never {
  throw new Error('scaleFinalBossStats not implemented — Wave 1 (05-02)')
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function checkMilestoneSpawns(...args: unknown[]): never {
  throw new Error('checkMilestoneSpawns not implemented — Wave 1 (05-02)')
}
