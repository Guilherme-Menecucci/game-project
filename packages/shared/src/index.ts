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
