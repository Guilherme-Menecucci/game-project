/**
 * bossCatalog — biome boss and final boss stat tables (GAME-13/14, BIOM-02).
 *
 * `scaleFinalBossStats` implements the meta-progression hook contract (D-11):
 * a pure function taking `metaProgressionLevel` (hardcoded to 0 in this
 * phase — Phase 7 will pass real values without signature changes). At
 * level 0 the final boss is near-undefeatable (>= 10x baseHp); stats
 * decrease as the level rises but never drop below the catalog baseline.
 */

export interface BossCatalogEntry {
  id: string
  bossKey: 'patient_zero' | 'unfinished_one'
  name: string
  displayName: string
  baseHp: number
  baseSpeed: number
  // Phase 5: damage dealt to players in ENEMY_CONTACT_RADIUS on the 'attacking'
  // transition of the D-19 telegraph state machine (applyBossAI in weapons.ts).
  contactDamage: number
  description: string
}

export const bossCatalog: Record<string, BossCatalogEntry> = {
  patient_zero: {
    id: 'patient_zero',
    bossKey: 'patient_zero',
    name: 'Patient Zero',
    displayName: 'Patient Zero',
    baseHp: 3000,
    baseSpeed: 6000,
    contactDamage: 10,
    description: 'The biome boss — a large, lumbering humanoid that telegraphs heavy attacks.',
  },
  unfinished_one: {
    id: 'unfinished_one',
    bossKey: 'unfinished_one',
    name: 'The Unfinished One',
    displayName: 'The Unfinished One',
    baseHp: 8000,
    baseSpeed: 5000,
    contactDamage: 15,
    description: 'The final boss — a massive, blocky horror that caps the 30-minute run.',
  },
}

/**
 * scaleFinalBossStats(base, metaProgressionLevel) — meta-progression hook
 * (D-11). At metaProgressionLevel 0, hp is 10x baseHp (near-undefeatable).
 * Higher levels reduce hp/speed toward the catalog baseline, but never
 * below it.
 */
export function scaleFinalBossStats(
  base: { baseHp: number; baseSpeed: number },
  metaProgressionLevel: number
): { hp: number; speed: number } {
  const hp = Math.max(base.baseHp, base.baseHp * (10 - metaProgressionLevel * 0.5))
  const speed = Math.max(base.baseSpeed * 0.7, base.baseSpeed * (1.5 - metaProgressionLevel * 0.04))
  return { hp, speed }
}
