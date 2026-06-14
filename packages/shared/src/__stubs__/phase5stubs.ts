/**
 * Phase 5 Wave 0 throwing stubs.
 *
 * These placeholders let Wave 0 RED test files (created in plan 05-01) import
 * `eliteCatalog`, `MILESTONE_MS`, and `checkMilestoneSpawns` from
 * `@game/shared` and resolve at COMPILE TIME, while failing at
 * ASSERTION/CALL time (RED) until plan 05-02's Task 2 replaces these with
 * real implementations.
 *
 * `characterCatalog`, `bossCatalog`, and `scaleFinalBossStats` were moved to
 * their real implementations (characterCatalog.ts / bossCatalog.ts) in
 * plan 05-02 Task 1 and removed from this stub file to avoid duplicate
 * barrel exports.
 *
 * The catalogs are empty objects (not throwing getters) so that
 * `eliteCatalog['elite1']` safely evaluates to `undefined` — Wave 0 tests
 * assert these entries are NOT undefined and thus fail RED for the correct
 * reason (missing catalog entry), not a module-load crash that would hide
 * other passing tests in the same file.
 *
 * Task 2 (05-02) deletes this file and replaces the barrel re-export below
 * with the real `export * from './eliteCatalog.js'` and
 * `export * from './runMilestones.js'`.
 */

// ─── Catalogs (empty — Task 2 populates) ───────────────────────────────────

export const eliteCatalog: Record<string, never> = {}
export const MILESTONE_MS: Record<string, never> = {}

// ─── Functions (throw — Task 2 implements) ─────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function checkMilestoneSpawns(...args: unknown[]): never {
  throw new Error('checkMilestoneSpawns not implemented — Wave 1 (05-02)')
}
