/**
 * spawnEnemies — applies spawn curve logic and adds enemies to state.
 * Stub: throws 'not implemented' until Task 2 of plan 03-02 implements it.
 */
import type { PlainGameState } from './state.js'
import type { Prng } from './prng.js'

export const BASE_SPAWN_INTERVAL_MS = 2000
export const MIN_SPAWN_INTERVAL_MS = 300
export const BASE_MAX_ENEMIES = 20
export const MAX_ENEMIES_CAP = 300

export const XP_PER_ARCHETYPE: Record<'swarmer' | 'tank' | 'ranged', number> = {
  swarmer: 1,
  tank: 3,
  ranged: 2,
}

export function spawnEnemies(state: PlainGameState, prng: Prng): PlainGameState {
  void state
  void prng
  throw new Error('not implemented')
}
