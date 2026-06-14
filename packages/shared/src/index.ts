// @game/shared — public API barrel
// All game schemas, types, and simulation exports.

// ─── Schemas and input types ──────────────────────────────────────────────────
export * from './schemas.js'

// ─── Phase 3 types and implementations ───────────────────────────────────────

// Real implementations (Task 1: 03-02)
export * from './state.js'
export * from './prng.js'
export * from './spatialGrid.js'

// Real implementations (Task 2: 03-02)
export * from './simulateTick.js'
export * from './spawn.js'

// Real implementations (Task 1: 03-06)
export * from './weapons.js'

// ─── Phase 4 types and implementations ───────────────────────────────────────
export * from './weaponCatalog.js'
export * from './passiveCatalog.js'
export * from './upgrades.js'

// ─── Phase 5 ────────────────────────────────────────────────────────────────
export * from './characterCatalog.js'
export * from './bossCatalog.js'

// ─── Phase 5 (stubs — replaced in Task 2, plan 05-02) ──────────────────────────
export * from './__stubs__/phase5stubs.js'
