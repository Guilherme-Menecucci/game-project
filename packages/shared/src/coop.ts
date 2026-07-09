/**
 * coop.ts — co-op downed/revive/eliminated pipeline step (ROOM-07/08/09).
 *
 * Pure function — takes PlainGameState, returns NEW PlainGameState.
 * NEVER mutates input state. NEVER calls Math.random() and draws NOTHING from
 * the prng (a pure state transform — no new draws means no draw-order drift
 * between solo and coop, Pitfall 2).
 *
 * Runs as step 8.5 in simulateTick, between applyEnemyContactDamage (step 8)
 * and applyBossAI (step 9) — damage dealt this tick is visible before the
 * down-transition, mirroring the defeat-detection placement rationale.
 *
 * Locked decisions (CONTEXT + OQ1):
 *   - hp 0 in coop → downed (crawling), NOT dead: 30s bleed-out clock starts.
 *   - Revive: any alive teammate within REVIVE_RADIUS for REVIVE_TICKS
 *     CONSECUTIVE ticks revives at ceil(maxHp/2). Leaving the radius resets
 *     progress. The reviver is never movement-locked (no reviver-side state).
 *   - Bleed-out expiry → eliminated (spectator). Eliminated players stay in
 *     state.players and are skipped by every sim pass.
 *   - Enemies never target or damage downed/eliminated players — bleed-out is
 *     the ONLY death clock while downed (see targetablePlayers in weapons.ts).
 *   - No-op when state.mode !== 'coop' — solo stays byte-identical to Phase 5.
 */

import type { PlainGameState, PlainPlayerState } from './state.js'
import { ENEMY_CONTACT_RADIUS, toroidalDistSq } from './weapons.js'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Bleed-out clock while downed: 30 seconds (ROOM-07). */
export const BLEED_OUT_MS = 30_000
/** Consecutive in-radius ticks required to revive: 60 ticks = 3s at 20Hz (ROOM-08). */
export const REVIVE_TICKS = 60
/** Revive proximity radius: 2 × ENEMY_CONTACT_RADIUS = 40,000 sub-units (ROOM-08). */
export const REVIVE_RADIUS = 2 * ENEMY_CONTACT_RADIUS
/** Downed players crawl at 30% speed (locked decision). */
export const DOWNED_SPEED_MULT = 0.3

// Tick duration in ms — must match simulateTick's TICK_SEC * 1000. Defined
// locally (not imported from simulateTick.js) to avoid a circular import.
const TICK_MS = 50

const REVIVE_RADIUS_SQ = REVIVE_RADIUS * REVIVE_RADIUS

// ─── applyDownedRevive ────────────────────────────────────────────────────────

/**
 * applyDownedRevive(state) — downed/revive/eliminated transitions (step 8.5).
 *
 * No-op when state.mode !== 'coop'. Two deterministic, order-independent passes:
 *   Pass 1 — down-transitions: any alive player at hp <= 0 becomes downed with
 *     a fresh bleed-out clock (hp pinned to 0). Computed for ALL players before
 *     revive checks so a teammate hitting 0 this tick never counts as a reviver.
 *   Pass 2 — per downed player: decrement bleed-out by TICK_MS; if any alive
 *     teammate is within REVIVE_RADIUS (toroidal), increment reviveProgressTicks
 *     (revive at REVIVE_TICKS: downed=false, hp=ceil(maxHp/2), fields reset);
 *     otherwise reset progress to 0 (continuous proximity required). If the
 *     clock reaches 0 while still downed: eliminated=true, downed=false.
 */
export function applyDownedRevive(state: PlainGameState): PlainGameState {
  if (state.mode !== 'coop') return state
  if (state.players.size === 0) return state

  // Pass 1: down-transitions.
  const working = new Map<string, PlainPlayerState>()
  let changed = false
  for (const [id, p] of state.players) {
    if (!p.downed && !p.eliminated && p.hp <= 0) {
      working.set(id, {
        ...p,
        hp: 0,
        downed: true,
        bleedOutRemainingMs: BLEED_OUT_MS,
        reviveProgressTicks: 0,
      })
      changed = true
    } else {
      working.set(id, p)
    }
  }

  // Pass 2: bleed-out / revive / eliminate. Teammate aliveness reads the
  // post-pass-1 flags but PRE-pass-2 values, keeping the result independent of
  // players-map iteration order (two simultaneously-downed players can never
  // revive each other within the same tick).
  const result = new Map<string, PlainPlayerState>()
  for (const [id, p] of working) {
    if (!p.downed) {
      result.set(id, p)
      continue
    }
    changed = true
    const next: PlainPlayerState = { ...p }
    next.bleedOutRemainingMs = (next.bleedOutRemainingMs ?? BLEED_OUT_MS) - TICK_MS

    let teammateNear = false
    for (const [otherId, other] of working) {
      if (otherId === id) continue
      if (other.downed || other.eliminated) continue
      if (toroidalDistSq(p.x, p.y, other.x, other.y) <= REVIVE_RADIUS_SQ) {
        teammateNear = true
        break
      }
    }

    if (teammateNear) {
      next.reviveProgressTicks = (next.reviveProgressTicks ?? 0) + 1
      if (next.reviveProgressTicks >= REVIVE_TICKS) {
        // Revived at 50% maxHp; bleed-out/revive fields reset.
        next.downed = false
        next.hp = Math.ceil(next.maxHp / 2)
        next.bleedOutRemainingMs = 0
        next.reviveProgressTicks = 0
      }
    } else {
      // Continuous proximity required — any gap resets the channel.
      next.reviveProgressTicks = 0
    }

    if (next.downed && next.bleedOutRemainingMs <= 0) {
      // Bleed-out expired: eliminated (spectator). Stays in state.players.
      next.eliminated = true
      next.downed = false
      next.bleedOutRemainingMs = 0
      next.reviveProgressTicks = 0
    }

    result.set(id, next)
  }

  if (!changed) return state
  return { ...state, players: result }
}
