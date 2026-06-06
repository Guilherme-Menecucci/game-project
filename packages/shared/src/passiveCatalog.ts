export interface PassiveCatalogEntry {
  id: string
  displayName: string
  stat: 'damage' | 'speed' | 'fireRate' | 'maxHp'
  delta: number
}

export const passiveCatalog: Record<string, PassiveCatalogEntry> = {
  spinach: {
    id: 'spinach',
    displayName: 'Spinach',
    stat: 'damage',
    delta: 10,
  },
  boots: {
    id: 'boots',
    displayName: 'Boots',
    stat: 'speed',
    delta: 500,
  },
  empty_tome: {
    id: 'empty_tome',
    displayName: 'Empty Tome',
    stat: 'fireRate',
    delta: -2,
  },
  bracer: {
    id: 'bracer',
    displayName: 'Bracer',
    stat: 'fireRate',
    delta: -2,
  },
}
