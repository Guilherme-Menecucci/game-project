export interface PassiveCatalogEntry {
  id: string
  displayName: string
  stat: 'damage' | 'speed' | 'fireRate' | 'maxHp'
  delta: number
  description: string
}

export const passiveCatalog: Record<string, PassiveCatalogEntry> = {
  spinach: {
    id: 'spinach',
    displayName: 'Spinach',
    stat: 'damage',
    delta: 10,
    description: 'Increases damage dealt by 10%.',
  },
  boots: {
    id: 'boots',
    displayName: 'Boots',
    stat: 'speed',
    delta: 500,
    description: 'Increases movement speed.',
  },
  empty_tome: {
    id: 'empty_tome',
    displayName: 'Empty Tome',
    stat: 'fireRate',
    delta: -2,
    description: 'Decreases weapon cooldown (fire rate).',
  },
  bracer: {
    id: 'bracer',
    displayName: 'Bracer',
    stat: 'fireRate',
    delta: -2,
    description: 'Increases projectile speed.',
  },
}
