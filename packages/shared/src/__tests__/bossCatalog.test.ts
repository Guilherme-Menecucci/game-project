/**
 * bossCatalog / scaleFinalBossStats RED stubs (GAME-13/14).
 *
 * bossCatalog is exported as an empty `{}` stub and scaleFinalBossStats
 * throws 'not implemented — Wave 1 (05-02)' from
 * packages/shared/src/__stubs__/phase5stubs.ts. All assertions below FAIL
 * RED until plan 05-02 implements the real catalog and scaling function.
 */
import { describe, it, expect } from 'vitest'
import { bossCatalog, scaleFinalBossStats } from '@game/shared'

type BossEntry = {
  name: string
  baseHp: number
  baseSpeed: number
  displayName: string
}

describe('bossCatalog', () => {
  it('exports patient_zero and unfinished_one entries', () => {
    const keys = Object.keys(bossCatalog)
    expect(keys).toContain('patient_zero')
    expect(keys).toContain('unfinished_one')
  })
})

describe('scaleFinalBossStats', () => {
  it('metaProgressionLevel 0 produces near-undefeatable stats', () => {
    const unfinishedOne = (bossCatalog as Record<string, BossEntry>)['unfinished_one']!
    const scaled = scaleFinalBossStats(unfinishedOne, 0) as { hp: number }
    expect(scaled.hp).toBeGreaterThanOrEqual(unfinishedOne.baseHp * 5)
  })

  it('metaProgressionLevel > 0 reduces stats relative to level 0', () => {
    const unfinishedOne = (bossCatalog as Record<string, BossEntry>)['unfinished_one']!
    const scaledLevel0 = scaleFinalBossStats(unfinishedOne, 0) as { hp: number }
    const scaledLevel5 = scaleFinalBossStats(unfinishedOne, 5) as { hp: number }
    expect(scaledLevel5.hp).toBeLessThan(scaledLevel0.hp)
  })

  it('never returns hp below baseHp', () => {
    const unfinishedOne = (bossCatalog as Record<string, BossEntry>)['unfinished_one']!
    const scaled = scaleFinalBossStats(unfinishedOne, 100) as { hp: number }
    expect(scaled.hp).toBeGreaterThanOrEqual(unfinishedOne.baseHp)
  })
})
