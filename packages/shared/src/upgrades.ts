import type { PlainGameState } from './state.js'
import type { Prng } from './prng.js'
import { cloneState } from './simulateTick.js'
import { weaponCatalog, evolutionCatalog } from './weaponCatalog.js'
import { passiveCatalog } from './passiveCatalog.js'

export interface UpgradeOption {
  id: string
  displayName: string
  kind: 'weapon' | 'passive' | 'evolution'
  description: string
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

  // Parse current levels of player's weapons and passives
  const currentWeaponLevels: Record<string, number> = {}
  for (const w of player.weapons) {
    const [id, lvlStr] = w.split(':')
    const level = lvlStr ? parseInt(lvlStr, 10) : 1
    currentWeaponLevels[id] = level
  }

  const currentPassiveLevels: Record<string, number> = {}
  for (const p of player.passives) {
    const [id, lvlStr] = p.split(':')
    const level = lvlStr ? parseInt(lvlStr, 10) : 1
    currentPassiveLevels[id] = level
  }

  // Identify prerequisites of currently owned evolved weapons to exclude them
  const evolvedPrereqWeapons = new Set<string>()
  const evolvedPrereqPassives = new Set<string>()

  for (const w of player.weapons) {
    const evo = evolutionCatalog[w]
    if (evo) {
      evolvedPrereqWeapons.add(evo.requires.weapon)
      evolvedPrereqPassives.add(evo.requires.passive)
    }
  }

  // 1. Add weapons from catalog
  for (const id of Object.keys(weaponCatalog)) {
    const isConsumed = evolvedPrereqWeapons.has(id)
    if (isConsumed) {
      continue
    }

    const currentLvl = currentWeaponLevels[id]
    if (currentLvl !== undefined) {
      // Offer upgrade to next level if below max (5)
      if (currentLvl < 5) {
        pool.push({
          id: `${id}:${currentLvl + 1}`,
          displayName: `${weaponCatalog[id].displayName} (Lv ${currentLvl + 1})`,
          kind: 'weapon',
          description: `Upgrade ${weaponCatalog[id].displayName} to Level ${currentLvl + 1}.`,
        })
      }
    } else {
      // Offer acquiring at Lv 1 if not full
      const isFull = player.weapons.length >= 6
      if (!isFull) {
        pool.push({
          id: `${id}:1`,
          displayName: `${weaponCatalog[id].displayName} (Lv 1)`,
          kind: 'weapon',
          description: weaponCatalog[id].description,
        })
      }
    }
  }

  // 2. Add passives from catalog
  for (const id of Object.keys(passiveCatalog)) {
    const isConsumed = evolvedPrereqPassives.has(id)
    if (isConsumed) {
      continue
    }

    const currentLvl = currentPassiveLevels[id]
    if (currentLvl !== undefined) {
      // Offer upgrade to next level if below max (5)
      if (currentLvl < 5) {
        pool.push({
          id: `${id}:${currentLvl + 1}`,
          displayName: `${passiveCatalog[id].displayName} (Lv ${currentLvl + 1})`,
          kind: 'passive',
          description: `Upgrade ${passiveCatalog[id].displayName} to Level ${currentLvl + 1}.`,
        })
      }
    } else {
      // Offer acquiring at Lv 1 if not full
      const isFull = player.passives.length >= 6
      if (!isFull) {
        pool.push({
          id: `${id}:1`,
          displayName: `${passiveCatalog[id].displayName} (Lv 1)`,
          kind: 'passive',
          description: passiveCatalog[id].description,
        })
      }
    }
  }

  // 3. Add evolutions from catalog - ONLY if required items are Level 5
  for (const id of Object.keys(evolutionCatalog)) {
    const evo = evolutionCatalog[id]
    const hasMaxWeapon = currentWeaponLevels[evo.requires.weapon] === 5
    const hasMaxPassive = currentPassiveLevels[evo.requires.passive] === 5
    if (hasMaxWeapon && hasMaxPassive) {
      pool.push({
        id,
        displayName: evo.displayName,
        kind: 'evolution',
        description: evo.description,
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
    const weaponIdx = player.weapons.findIndex((w) => w.startsWith(evo.requires.weapon))
    const passiveIdx = player.passives.findIndex((p) => p.startsWith(evo.requires.passive))
    if (weaponIdx !== -1 && passiveIdx !== -1) {
      // Replace base weapon in-place at the same slot index (D-12/D-21). This
      // preserves weaponStats[String(weaponIdx)] so DPS attribution from the base
      // weapon automatically continues to apply to the evolved weapon (no key
      // remapping needed). If no weaponStats entry exists for this slot yet,
      // leave it absent — D-21 treats a missing entry as "no data yet".
      player.weapons[weaponIdx] = upgradeId
      // Remove the prerequisite passive (the weapon replaces in-place; only
      // the passive must be spliced out to free a passive slot).
      player.passives.splice(passiveIdx, 1)
    }
    return nextState
  }

  // 2. Check if weapon
  const [wId] = upgradeId.split(':')
  if (weaponCatalog[wId]) {
    const idx = player.weapons.findIndex((w) => w.startsWith(wId))
    if (idx !== -1) {
      // Level-up: replace weapon in-place. weaponStats[String(idx)] is
      // intentionally left untouched — slot index is stable, existing
      // totalDamage and acquiredAtMs remain valid (D-21 slot-index contract).
      player.weapons[idx] = upgradeId
    } else {
      if (player.weapons.length < 6) {
        // New weapon acquisition: push into the next available slot and
        // initialize a fresh weaponStats entry. acquiredAtMs is stamped to
        // the current tick's elapsedMs so DPS computation has accurate elapsed
        // time from the moment the weapon first became active (D-21).
        player.weapons.push(upgradeId)
        const newIndex = player.weapons.length - 1
        if (!player.weaponStats) player.weaponStats = {}
        player.weaponStats[String(newIndex)] = { totalDamage: 0, acquiredAtMs: nextState.elapsedMs }
      }
    }
    return nextState
  }

  // 3. Check if passive
  const [pId] = upgradeId.split(':')
  if (passiveCatalog[pId]) {
    const idx = player.passives.findIndex((p) => p.startsWith(pId))
    if (idx !== -1) {
      player.passives[idx] = upgradeId
    } else {
      if (player.passives.length < 6) {
        player.passives.push(upgradeId)
      }
    }

    // Recalculate speed if boots upgraded
    let bootsLvl = 0
    const bootsItem = player.passives.find((p) => p.startsWith('boots'))
    if (bootsItem) {
      bootsLvl = parseInt(bootsItem.split(':')[1] || '1', 10)
    }
    const BOOTS_SPEEDS = [0, 150, 300, 450, 600, 800]
    player.speed = 10_000 + (BOOTS_SPEEDS[bootsLvl] || 0)

    return nextState
  }

  return state
}
