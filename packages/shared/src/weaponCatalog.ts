export interface WeaponCatalogEntry {
  id: string
  name: string
  displayName: string
  damage: number
  fireRateTicks: number
  projectileSpeed: number
  evolvesFrom?: never
}

export interface EvolutionEntry {
  id: string
  displayName: string
  requires: {
    weapon: string
    passive: string
  }
}

export const weaponCatalog: Record<string, WeaponCatalogEntry> = {
  magic_wand: {
    id: 'magic_wand',
    name: 'magic_wand',
    displayName: 'Magic Wand',
    damage: 10,
    fireRateTicks: 20,
    projectileSpeed: 150_000,
  },
  garlic: {
    id: 'garlic',
    name: 'garlic',
    displayName: 'Garlic',
    damage: 5,
    fireRateTicks: 10,
    projectileSpeed: 0,
  },
  knife: {
    id: 'knife',
    name: 'knife',
    displayName: 'Knife',
    damage: 15,
    fireRateTicks: 15,
    projectileSpeed: 200_000,
  },
  bible: {
    id: 'bible',
    name: 'bible',
    displayName: 'Bible',
    damage: 8,
    fireRateTicks: 30,
    projectileSpeed: 0,
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
  },
  thousand_edge: {
    id: 'thousand_edge',
    displayName: 'Thousand Edge',
    requires: {
      weapon: 'knife',
      passive: 'bracer',
    },
  },
}
