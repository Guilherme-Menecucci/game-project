/**
 * eliteCatalog — milestone elite enemies (D-25, GAME-15).
 *
 * elite1-3 derive their stats from the existing enemy archetypes in
 * spawn.ts's `archetypeStats`, scaled 1.4x per D-25:
 *   - swarmer: { hp: 1, speed: 7_500 }  -> elite1 "Stitched Orderly"
 *   - ranged:  { hp: 3, speed: 4_500 }  -> elite2 "The Harvester"
 *   - tank:    { hp: 10, speed: 3_000 } -> elite3 "Meat Golem"
 *
 * elite4 "Brain Jar Crawler" is a standalone shape (no base archetype
 * reuse for stats) with hp/speed comparable to or slightly exceeding
 * elite3's scaled values, since it spawns last/hardest.
 */

export interface EliteCatalogEntry {
  id: string
  eliteName: string
  baseArchetype: 'swarmer' | 'tank' | 'ranged' | 'standalone'
  /**
   * spawnArchetype — the `PlainEnemyState.archetype` value used when this
   * elite is instantiated by `checkMilestoneSpawns`. `PlainEnemyState` only
   * accepts the 3-member archetype union (no 'standalone'), so elite4 maps
   * to 'tank' here (closest in spirit: highest hp/speed of the four elites).
   */
  spawnArchetype: 'swarmer' | 'tank' | 'ranged'
  hp: number
  maxHp: number
  speed: number
  displayName: string
  description: string
}

export const eliteCatalog: Record<string, EliteCatalogEntry> = {
  elite1: {
    id: 'elite1',
    eliteName: 'Stitched Orderly',
    baseArchetype: 'swarmer',
    spawnArchetype: 'swarmer',
    hp: 2, // ceil(1 * 1.4) — integer to avoid uint8 truncation in GameSchema
    maxHp: 2,
    speed: 10_500, // 7_500 * 1.4
    displayName: 'Stitched Orderly',
    description: 'A reanimated orderly, faster and tougher than a common swarmer.',
  },
  elite2: {
    id: 'elite2',
    eliteName: 'The Harvester',
    baseArchetype: 'ranged',
    spawnArchetype: 'ranged',
    hp: 5, // round(3 * 1.4) + 1 — integer to avoid uint8 truncation in GameSchema
    maxHp: 5,
    speed: 6_300, // 4_500 * 1.4
    displayName: 'The Harvester',
    description: 'A grasping limb construct that strikes from range.',
  },
  elite3: {
    id: 'elite3',
    eliteName: 'Meat Golem',
    baseArchetype: 'tank',
    spawnArchetype: 'tank',
    hp: 14, // 10 * 1.4
    maxHp: 14,
    speed: 4_200, // 3_000 * 1.4
    displayName: 'Meat Golem',
    description: 'A hulking mass of stitched flesh that shrugs off hits.',
  },
  elite4: {
    id: 'elite4',
    eliteName: 'Brain Jar Crawler',
    baseArchetype: 'standalone',
    spawnArchetype: 'tank',
    hp: 16, // exceeds elite3's scaled hp — last/hardest elite
    maxHp: 16,
    speed: 4_600, // exceeds elite3's scaled speed
    displayName: 'Brain Jar Crawler',
    description: 'A glass jar skittering on stolen legs, the final elite before the boss.',
  },
}
