/**
 * characterCatalog — playable character classes (CHAR-01/02, D-03/D-04).
 *
 * Each class has a distinct stat-multiplier profile applied via direct
 * multiplication at point of use (no generic modifier-stack system — YAGNI).
 * `human` is the baseline (multipliers === 1.0), matching the current
 * makeInitialState p1 defaults.
 */

export interface CharacterCatalogEntry {
  id: string
  classId: 'vampire' | 'human' | 'dwarf'
  displayName: string
  baseMaxHp: number
  baseSpeed: number
  damageMultiplier: number
  fireRateMultiplier: number
  description: string
}

export const characterCatalog: Record<string, CharacterCatalogEntry> = {
  vampire: {
    id: 'vampire',
    classId: 'vampire',
    displayName: 'Vampire',
    baseMaxHp: 80,
    baseSpeed: 12_000,
    damageMultiplier: 1.2,
    fireRateMultiplier: 0.9,
    description: "Frail but ferocious — strikes harder and faster, can't take many hits.",
  },
  human: {
    id: 'human',
    classId: 'human',
    displayName: 'Human',
    baseMaxHp: 100,
    baseSpeed: 10_000,
    damageMultiplier: 1.0,
    fireRateMultiplier: 1.0,
    description: 'The baseline survivor — no strengths, no weaknesses.',
  },
  dwarf: {
    id: 'dwarf',
    classId: 'dwarf',
    displayName: 'Dwarf',
    baseMaxHp: 130,
    baseSpeed: 8_000,
    damageMultiplier: 1.1,
    fireRateMultiplier: 1.1,
    description: 'Built like a bunker — tougher and steadier, but slower to react.',
  },
}
