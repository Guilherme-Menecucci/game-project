import type { PlainGameState } from './state.js'
import type { Prng } from './prng.js'
import { cloneState } from './simulateTick.js'
import { weaponCatalog, evolutionCatalog } from './weaponCatalog.js'
import { passiveCatalog } from './passiveCatalog.js'

export interface UpgradeOption {
  id: string
  displayName: string
  kind: 'weapon' | 'passive' | 'evolution'
}

/**
 * Deterministic Fisher-Yates shuffle using seeded PRNG.
 */
function shuffle<T>(array: T[], prng: Prng): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(prng.next() * (i + 1))
    const temp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = temp
  }
  return shuffled
}

/**
 * selectUpgradeOptions — returns up to 3 upgrade options for a player.
 * Enforces slot limits (D-11) and evolution prerequisites (D-12).
 */
export function selectUpgradeOptions(
  state: PlainGameState,
  playerId: string,
  prng: Prng
): UpgradeOption[] {
  const player = state.players.get(playerId)
  if (!player) return []

  const pool: UpgradeOption[] = []

  // 1. Add weapons from catalog
  for (const id of Object.keys(weaponCatalog)) {
    const isOwned = player.weapons.includes(id)
    const isFull = player.weapons.length >= 6
    if (isFull && !isOwned) {
      // If weapon slots are full, do not offer new weapons
      continue
    }
    pool.push({
      id,
      displayName: weaponCatalog[id].displayName,
      kind: 'weapon',
    })
  }

  // 2. Add passives from catalog
  for (const id of Object.keys(passiveCatalog)) {
    const isOwned = player.passives.includes(id)
    const isFull = player.passives.length >= 6
    if (isFull && !isOwned) {
      // If passive slots are full, do not offer new passives
      continue
    }
    pool.push({
      id,
      displayName: passiveCatalog[id].displayName,
      kind: 'passive',
    })
  }

  // 3. Add evolutions from catalog
  for (const id of Object.keys(evolutionCatalog)) {
    const evo = evolutionCatalog[id]
    const hasWeapon = player.weapons.includes(evo.requires.weapon)
    const hasPassive = player.passives.includes(evo.requires.passive)
    if (hasWeapon && hasPassive) {
      pool.push({
        id,
        displayName: evo.displayName,
        kind: 'evolution',
      })
    }
  }

  // Shuffle pool deterministically and pick the first 3
  const shuffled = shuffle(pool, prng)
  return shuffled.slice(0, 3)
}

/**
 * applyUpgrade — applies an upgrade option to a player's loadout.
 * Returns a new PlainGameState (pure function).
 */
export function applyUpgrade(
  state: PlainGameState,
  playerId: string,
  upgradeId: string
): PlainGameState {
  const nextState = cloneState(state)
  const player = nextState.players.get(playerId)
  if (!player) return state

  // 1. Check if evolution
  const evo = evolutionCatalog[upgradeId]
  if (evo) {
    const weaponIdx = player.weapons.indexOf(evo.requires.weapon)
    const passiveIdx = player.passives.indexOf(evo.requires.passive)
    // Verify prerequisites actually met on server
    if (weaponIdx !== -1 && passiveIdx !== -1) {
      player.weapons.splice(weaponIdx, 1)
      player.passives.splice(passiveIdx, 1)
      player.weapons.push(upgradeId)
    }
    return nextState
  }

  // 2. Check if weapon
  if (weaponCatalog[upgradeId]) {
    if (!player.weapons.includes(upgradeId)) {
      if (player.weapons.length < 6) {
        player.weapons.push(upgradeId)
      }
    }
    return nextState
  }

  // 3. Check if passive
  if (passiveCatalog[upgradeId]) {
    if (!player.passives.includes(upgradeId)) {
      if (player.passives.length < 6) {
        player.passives.push(upgradeId)
      }
    }
    return nextState
  }

  return state
}
