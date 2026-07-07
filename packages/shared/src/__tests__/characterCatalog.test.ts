/**
 * characterCatalog RED stubs (CHAR-01/02).
 *
 * characterCatalog is exported as an empty `{}` stub from
 * packages/shared/src/__stubs__/phase5stubs.ts until plan 05-02 (Wave 1)
 * implements the real catalog. All assertions below FAIL RED with
 * "Cannot read properties of undefined" or length-mismatch errors.
 */
import { describe, it, expect } from 'vitest'
import { characterCatalog } from '@game/shared'

describe('characterCatalog', () => {
  it('exports exactly 3 classes: vampire, human, dwarf', () => {
    const keys = Object.keys(characterCatalog)
    expect(keys.length).toBe(3)
    expect(keys).toContain('vampire')
    expect(keys).toContain('human')
    expect(keys).toContain('dwarf')
  })

  it('human is the baseline (multipliers === 1.0)', () => {
    const human = (
      characterCatalog as Record<string, { damageMultiplier: number; fireRateMultiplier: number }>
    )['human']
    expect(human.damageMultiplier).toBe(1.0)
    expect(human.fireRateMultiplier).toBe(1.0)
  })

  it('vampire and dwarf each have a distinct damageMultiplier or fireRateMultiplier or baseMaxHp or baseSpeed vs human (CHAR-01 distinct identity)', () => {
    type ClassEntry = {
      baseMaxHp: number
      baseSpeed: number
      damageMultiplier: number
      fireRateMultiplier: number
    }
    const catalog = characterCatalog as Record<string, ClassEntry>
    const human = catalog['human']!
    for (const classId of ['vampire', 'dwarf']) {
      const entry = catalog[classId]!
      const distinct =
        entry.baseMaxHp !== human.baseMaxHp ||
        entry.baseSpeed !== human.baseSpeed ||
        entry.damageMultiplier !== human.damageMultiplier ||
        entry.fireRateMultiplier !== human.fireRateMultiplier
      expect(distinct).toBe(true)
    }
  })

  it('every class entry has baseMaxHp, baseSpeed, damageMultiplier, fireRateMultiplier, displayName, description', () => {
    const requiredKeys = [
      'baseMaxHp',
      'baseSpeed',
      'damageMultiplier',
      'fireRateMultiplier',
      'displayName',
      'description',
    ]
    for (const [, entry] of Object.entries(characterCatalog)) {
      const entryKeys = Object.keys(entry as object)
      for (const key of requiredKeys) {
        expect(entryKeys).toContain(key)
      }
    }
    // Force at least one iteration even if characterCatalog is empty —
    // an empty catalog should also fail this test (no classes to check).
    expect(Object.keys(characterCatalog).length).toBeGreaterThan(0)
  })
})
