export interface WeaponCatalogEntry {
  id: string
  name: string
  displayName: string
  damage: number
  fireRateTicks: number
  projectileSpeed: number
  evolvesFrom?: never
  description: string
}

export interface EvolutionEntry {
  id: string
  displayName: string
  requires: {
    weapon: string
    passive: string
  }
  description: string
}

export const weaponCatalog: Record<string, WeaponCatalogEntry> = {
  magic_wand: {
    id: 'magic_wand',
    name: 'magic_wand',
    displayName: 'Magic Wand',
    damage: 10,
    fireRateTicks: 20,
    projectileSpeed: 150_000,
    description: 'Fires magic projectiles at the nearest enemy.',
  },
  garlic: {
    id: 'garlic',
    name: 'garlic',
    displayName: 'Garlic',
    damage: 5,
    fireRateTicks: 10,
    projectileSpeed: 0,
    description: 'Damages nearby enemies in a circular aura.',
  },
  knife: {
    id: 'knife',
    name: 'knife',
    displayName: 'Knife',
    damage: 15,
    fireRateTicks: 15,
    projectileSpeed: 200_000,
    description: 'Fires knives in the direction of movement.',
  },
  bible: {
    id: 'bible',
    name: 'bible',
    displayName: 'Bible',
    damage: 8,
    fireRateTicks: 30,
    projectileSpeed: 0,
    description: 'Orbits around the player to block and damage enemies.',
  },
}

export const evolutionCatalog: Record<string, EvolutionEntry> = {
  holy_wand: {
    id: 'holy_wand',
    displayName: 'Holy Wand',
    requires: {
      weapon: 'magic_wand',
      passive: 'empty_tome',
    },
    description: 'Evolved Magic Wand. Fires continuously with no cooldown.',
  },
  thousand_edge: {
    id: 'thousand_edge',
    displayName: 'Thousand Edge',
    requires: {
      weapon: 'knife',
      passive: 'bracer',
    },
    description: 'Evolved Knife. Fires knives continuously with no cooldown.',
  },
}
