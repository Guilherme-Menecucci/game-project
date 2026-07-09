/**
 * downed.test.ts — coop downed/revive/eliminated pipeline spec (ROOM-07/08/09).
 *
 * Locked decisions encoded here:
 *   - hp 0 in coop → downed with a 30s bleed-out clock (30_000ms − 50/tick),
 *     NOT instant defeat. Solo keeps the Phase 5 instant-defeat rule.
 *   - Revive: a teammate staying within REVIVE_RADIUS (2 × ENEMY_CONTACT_RADIUS
 *     = 40_000 sub-units, toroidal) for 60 CONSECUTIVE ticks (3s) revives the
 *     downed player at ceil(maxHp/2). Leaving the radius resets progress.
 *     The reviver is never movement-locked (no reviver-side state).
 *   - Bleed-out expiry → eliminated (spectator). Eliminated players REMAIN in
 *     state.players and are skipped by every sim pass.
 *   - Enemies/ranged/bosses never target or damage downed/eliminated players —
 *     bleed-out is the only death clock while downed (locked OQ1).
 *   - Downed players crawl at 30% speed and do not auto-fire. Eliminated
 *     players ignore input entirely and never fire.
 *   - Gem/XP collection stays individual; downed players still collect,
 *     eliminated players do not.
 *   - Coop defeat fires only when EVERY player is downed or eliminated.
 *
 * NOTE: constants are asserted as literals on purpose — the tests lock the
 * values (30_000 / 50 / 40_000 / 60 / 30%) independently of the constants
 * exported from coop.ts.
 */
import { describe, it, expect } from 'vitest'
import { simulateTick, makeInitialState, mulberry32 } from '@game/shared'
import type {
  PlainGameState,
  PlainPlayerState,
  PlainEnemyState,
  PlainBossState,
  PlainProjectileState,
  PlayerInput,
} from '@game/shared'

// Forward-typed views of the Phase 6 state contract. These intersections make
// the RED-phase file typecheck before state.ts gains the fields; after GREEN
// they are redundant no-ops (identical to the real optional fields).
type CoopPlayer = PlainPlayerState & {
  downed?: boolean
  bleedOutRemainingMs?: number
  reviveProgressTicks?: number
  eliminated?: boolean
}
type CoopState = PlainGameState & {
  mode?: 'solo' | 'coop'
  playerCount?: number
}

const CENTER = 2_048_000 // world center in sub-units (4,096,000 / 2)

/** Typed accessor for a player with the Phase 6 fields. */
function P(state: PlainGameState, id: string): CoopPlayer {
  return state.players.get(id)! as CoopPlayer
}

/**
 * makeInitialState + mode 'coop', playerCount n, n players at known positions.
 * Players are spread 300,000 sub-units apart along +x (well outside the
 * 40,000 sub-unit revive radius); tests reposition players as needed.
 */
function makeCoopState(n: number, seed = 42): CoopState {
  const state = makeInitialState(seed) as CoopState
  state.mode = 'coop'
  state.playerCount = n
  const p1 = state.players.get('p1')!
  p1.x = CENTER
  p1.y = CENTER
  for (let i = 2; i <= n; i++) {
    state.players.set(`p${i}`, {
      ...p1,
      id: `p${i}`,
      x: CENTER + 300_000 * (i - 1),
      y: CENTER,
      weapons: [...p1.weapons],
      passives: [...p1.passives],
      weaponStats: {},
    })
  }
  return state
}

function makeInput(mx: number, my: number): PlayerInput {
  return { moveVector: { x: mx, y: my }, aimAngle: 0, actionFlags: 0, seq: 0, tick: 0 }
}

function makeSwarmer(id: string, x: number, y: number): PlainEnemyState {
  return { id, x, y, hp: 10, maxHp: 10, archetype: 'swarmer', speed: 7_500, lastFireTick: 0 }
}

describe('coop downed transition (ROOM-07)', () => {
  it('hp 0 in coop → downed with 30s bleed-out clock, run continues', () => {
    const state = makeCoopState(2)
    state.players.get('p1')!.hp = 0

    const next = simulateTick(state, new Map(), mulberry32(1))

    const p1 = P(next, 'p1')
    expect(p1.downed).toBe(true)
    expect(p1.hp).toBe(0)
    // Down-transition sets 30_000, then the same tick's bleed-out pass decrements 50.
    expect(p1.bleedOutRemainingMs).toBe(30_000 - 50)
    // Squad still has an alive player → no defeat.
    expect(next.result).toBeUndefined()
  })

  it('bleedOutRemainingMs decrements 50 per tick while downed', () => {
    const state = makeCoopState(2)
    const p1 = P(state, 'p1')
    p1.hp = 0
    p1.downed = true
    p1.bleedOutRemainingMs = 29_950
    // p2 is 300,000 away (helper default) — no revive progress.

    const next = simulateTick(state, new Map(), mulberry32(1))

    expect(P(next, 'p1').bleedOutRemainingMs).toBe(29_900)
    expect(P(next, 'p1').downed).toBe(true)
  })

  it('solo regression: hp 0 → defeated immediately, no downed fields set', () => {
    const state = makeInitialState(42) // mode defaults to solo
    state.players.get('p1')!.hp = 0

    const next = simulateTick(state, new Map(), mulberry32(1))

    expect(next.result).toBe('defeated')
    const p1 = P(next, 'p1')
    expect(p1.downed).toBeUndefined()
    expect(p1.bleedOutRemainingMs).toBeUndefined()
    expect(p1.eliminated).toBeUndefined()
  })
})

describe('proximity revive (ROOM-08)', () => {
  it('teammate within REVIVE_RADIUS increments reviveProgressTicks', () => {
    const state = makeCoopState(2)
    const p1 = P(state, 'p1')
    p1.hp = 0
    p1.downed = true
    p1.bleedOutRemainingMs = 29_950
    // Within radius: 30,000 < 40,000 sub-units (2 × ENEMY_CONTACT_RADIUS).
    state.players.get('p2')!.x = CENTER + 30_000

    const next = simulateTick(state, new Map(), mulberry32(1))

    expect(P(next, 'p1').reviveProgressTicks).toBe(1)
    expect(P(next, 'p1').downed).toBe(true)
  })

  it('after 60 consecutive ticks in radius the player is revived at 50% maxHp', () => {
    const state = makeCoopState(2)
    const p1 = P(state, 'p1')
    p1.hp = 0
    p1.downed = true
    p1.bleedOutRemainingMs = 20_000
    p1.reviveProgressTicks = 59
    state.players.get('p2')!.x = CENTER + 30_000

    const next = simulateTick(state, new Map(), mulberry32(1))

    const revived = P(next, 'p1')
    expect(revived.downed).toBe(false)
    expect(revived.hp).toBe(Math.ceil(100 / 2)) // maxHp 100 → 50
    // Bleed-out / revive fields reset.
    expect(revived.bleedOutRemainingMs ?? 0).toBe(0)
    expect(revived.reviveProgressTicks ?? 0).toBe(0)
    expect(revived.eliminated ?? false).toBe(false)
  })

  it('teammate leaving the radius mid-channel resets reviveProgressTicks to 0', () => {
    const state = makeCoopState(2)
    const p1 = P(state, 'p1')
    p1.hp = 0
    p1.downed = true
    p1.bleedOutRemainingMs = 20_000
    p1.reviveProgressTicks = 30
    // Outside radius: 300,000 (helper default) > 40,000.

    const next = simulateTick(state, new Map(), mulberry32(1))

    expect(P(next, 'p1').reviveProgressTicks).toBe(0)
    expect(P(next, 'p1').downed).toBe(true)
  })

  it('reviver is never movement-locked (no reviver-side state)', () => {
    const state = makeCoopState(2)
    const p1 = P(state, 'p1')
    p1.hp = 0
    p1.downed = true
    p1.bleedOutRemainingMs = 20_000
    p1.reviveProgressTicks = 10
    state.players.get('p2')!.x = CENTER + 30_000

    const inputs = new Map([['p2', makeInput(0, 1)]])
    const next = simulateTick(state, inputs, mulberry32(1))

    // Full speed: 10,000 sub-units/tick — the reviver moves freely.
    expect(P(next, 'p2').y).toBe(CENTER + 10_000)
  })
})

describe('bleed-out expiry → eliminated (ROOM-09)', () => {
  it('bleed-out reaching 0 marks the player eliminated and keeps them in state.players', () => {
    const state = makeCoopState(2)
    const p1 = P(state, 'p1')
    p1.hp = 0
    p1.downed = true
    p1.bleedOutRemainingMs = 50 // one tick left

    const next = simulateTick(state, new Map(), mulberry32(1))

    const eliminated = P(next, 'p1')
    expect(eliminated.eliminated).toBe(true)
    expect(eliminated.downed).toBe(false)
    // Spectator stays in the players map (removing would shift scaling + HUD).
    expect(next.players.size).toBe(2)
    expect(next.players.has('p1')).toBe(true)
    // Teammate alive → no defeat.
    expect(next.result).toBeUndefined()
  })
})

describe('downed/eliminated movement and firing', () => {
  it('downed player moves at 30% speed (integer math)', () => {
    const state = makeCoopState(2)
    const p1 = P(state, 'p1')
    p1.hp = 0
    p1.downed = true
    p1.bleedOutRemainingMs = 20_000

    const inputs = new Map([['p1', makeInput(1, 0)]])
    const next = simulateTick(state, inputs, mulberry32(1))

    // Math.round(10_000 * 0.3) = 3_000 sub-units.
    expect(P(next, 'p1').x).toBe(CENTER + 3_000)
  })

  it('downed player does not auto-fire while alive teammates do', () => {
    const state = makeCoopState(2)
    const p1 = P(state, 'p1')
    p1.hp = 0
    p1.downed = true
    p1.bleedOutRemainingMs = 30_000
    p1.weapons = ['magic_wand:1']
    // An enemy well away from both players so projectiles have a target.
    state.enemies.set('e1', makeSwarmer('e1', CENTER + 600_000, CENTER + 600_000))

    const prng = mulberry32(1)
    let current: PlainGameState = state
    let sawP2Projectile = false
    let sawP1Projectile = false
    for (let i = 0; i < 40; i++) {
      current = simulateTick(current, new Map(), prng)
      for (const proj of current.projectiles.values()) {
        if (proj.isEnemy) continue
        if (proj.ownerId === 'p1') sawP1Projectile = true
        if (proj.ownerId === 'p2') sawP2Projectile = true
      }
    }

    expect(sawP2Projectile).toBe(true) // firing ticks did occur
    expect(sawP1Projectile).toBe(false) // downed player never fired
  })

  it('eliminated player ignores input entirely and never fires', () => {
    const state = makeCoopState(2)
    const p1 = P(state, 'p1')
    p1.hp = 0
    p1.eliminated = true
    p1.weapons = ['magic_wand:1']
    state.enemies.set('e1', makeSwarmer('e1', CENTER + 600_000, CENTER + 600_000))

    const prng = mulberry32(1)
    let current: PlainGameState = state
    let sawP1Projectile = false
    for (let i = 0; i < 40; i++) {
      const inputs = new Map([['p1', makeInput(1, 0)]])
      current = simulateTick(current, inputs, prng)
      for (const proj of current.projectiles.values()) {
        if (!proj.isEnemy && proj.ownerId === 'p1') sawP1Projectile = true
      }
    }

    expect(P(current, 'p1').x).toBe(CENTER) // input ignored — never moved
    expect(sawP1Projectile).toBe(false)
  })
})

describe('enemy/boss targeting excludes downed and eliminated players (locked OQ1)', () => {
  it('enemies target the nearest ALIVE player, not the downed one', () => {
    const state = makeCoopState(2)
    const p1 = P(state, 'p1')
    p1.hp = 0
    p1.downed = true
    p1.bleedOutRemainingMs = 30_000
    // Enemy just right of downed p1; alive p2 is far right.
    state.enemies.set('e1', makeSwarmer('e1', CENTER + 30_000, CENTER))

    const next = simulateTick(state, new Map(), mulberry32(1))

    // Toward p2 (+x). If it targeted downed p1 it would move −x.
    expect(next.enemies.get('e1')!.x).toBeGreaterThan(CENTER + 30_000)
  })

  it('downed player takes no enemy contact damage — bleed-out is the only clock', () => {
    const state = makeCoopState(2)
    const p1 = P(state, 'p1')
    // Synthetic hp>0 downed state makes the exclusion observable.
    p1.hp = 5
    p1.downed = true
    p1.bleedOutRemainingMs = 30_000
    state.enemies.set('e1', makeSwarmer('e1', CENTER, CENTER)) // overlapping p1

    const next = simulateTick(state, new Map(), mulberry32(1))

    expect(P(next, 'p1').hp).toBe(5)
  })

  it('downed player takes no enemy projectile damage', () => {
    const state = makeCoopState(2)
    const p1 = P(state, 'p1')
    p1.hp = 5
    p1.downed = true
    p1.bleedOutRemainingMs = 30_000
    const proj: PlainProjectileState = {
      id: 'eproj_test',
      x: CENTER,
      y: CENTER,
      vx: 0,
      vy: 0,
      ownerId: 'e_ghost',
      isEnemy: true,
      damage: 2,
      lifetime: 10,
    }
    state.projectiles.set(proj.id, proj)

    const next = simulateTick(state, new Map(), mulberry32(1))

    expect(P(next, 'p1').hp).toBe(5)
  })

  it('ranged enemies fire at the nearest ALIVE player', () => {
    const state = makeCoopState(2)
    const p1 = P(state, 'p1')
    p1.hp = 0
    p1.downed = true
    p1.bleedOutRemainingMs = 30_000
    // Ranged enemy between p1 (left) and p2 (far right); ready to fire.
    const ranged: PlainEnemyState = {
      id: 'r1',
      x: CENTER + 50_000,
      y: CENTER,
      hp: 3,
      maxHp: 3,
      archetype: 'ranged',
      speed: 4_500,
      lastFireTick: -100,
    }
    state.enemies.set('r1', ranged)

    const next = simulateTick(state, new Map(), mulberry32(1))

    const enemyProjectiles = [...next.projectiles.values()].filter((pr) => pr.isEnemy)
    expect(enemyProjectiles.length).toBeGreaterThan(0)
    // Fired toward p2 (+x). Toward downed p1 would be vx < 0.
    expect(enemyProjectiles[0]!.vx).toBeGreaterThan(0)
  })

  it('boss targets the nearest ALIVE player, not the downed one', () => {
    const state = makeCoopState(2)
    const p1 = P(state, 'p1')
    p1.hp = 0
    p1.downed = true
    p1.bleedOutRemainingMs = 30_000
    const boss: PlainBossState = {
      id: 'boss1',
      bossKey: 'patient_zero',
      name: 'Patient Zero',
      x: CENTER + 30_000,
      y: CENTER,
      hp: 5_000,
      maxHp: 5_000,
      speed: 5_000,
      telegraphTick: 0, // idle → moves toward target
    }
    state.bosses!.set('boss1', boss)

    const next = simulateTick(state, new Map(), mulberry32(1))

    // Toward alive p2 (+x). Toward downed p1 would be −x.
    expect(next.bosses!.get('boss1')!.x).toBeGreaterThan(CENTER + 30_000)
  })

  it('boss attack does not damage downed players', () => {
    const state = makeCoopState(2)
    const p1 = P(state, 'p1')
    p1.hp = 5
    p1.downed = true
    p1.bleedOutRemainingMs = 30_000
    const boss: PlainBossState = {
      id: 'boss1',
      bossKey: 'patient_zero',
      name: 'Patient Zero',
      x: CENTER,
      y: CENTER,
      hp: 5_000,
      maxHp: 5_000,
      speed: 5_000,
      telegraphTick: 99, // attacking this tick
    }
    state.bosses!.set('boss1', boss)

    const next = simulateTick(state, new Map(), mulberry32(1))

    expect(P(next, 'p1').hp).toBe(5)
  })
})

describe('gem collection stays individual (locked decision)', () => {
  it('the collecting player gets the XP — teammates do not', () => {
    const state = makeCoopState(2)
    // Gem within snap radius (10,000) of p2 only.
    state.gems.set('g1', { id: 'g1', x: CENTER + 300_000 + 5_000, y: CENTER, value: 3 })

    const next = simulateTick(state, new Map(), mulberry32(1))

    expect(P(next, 'p2').xp).toBe(3)
    expect(P(next, 'p1').xp).toBe(0)
    expect(next.gems.has('g1')).toBe(false)
  })

  it('a downed player still collects gems in its radius', () => {
    const state = makeCoopState(2)
    const p1 = P(state, 'p1')
    p1.hp = 0
    p1.downed = true
    p1.bleedOutRemainingMs = 30_000
    state.gems.set('g1', { id: 'g1', x: CENTER + 5_000, y: CENTER, value: 3 })

    const next = simulateTick(state, new Map(), mulberry32(1))

    expect(P(next, 'p1').xp).toBe(3)
    expect(next.gems.has('g1')).toBe(false)
  })

  it('an eliminated player does not collect gems', () => {
    const state = makeCoopState(2)
    const p1 = P(state, 'p1')
    p1.hp = 0
    p1.eliminated = true
    // Move p2 far away so the gem has no live collector in range.
    state.players.get('p2')!.x = CENTER + 500_000
    state.gems.set('g1', { id: 'g1', x: CENTER + 5_000, y: CENTER, value: 3 })

    const next = simulateTick(state, new Map(), mulberry32(1))

    expect(P(next, 'p1').xp).toBe(0)
    expect(next.gems.has('g1')).toBe(true) // uncollected
  })
})

describe('coop defeat detection (mode gate)', () => {
  it('defeat fires the tick every player is downed or eliminated', () => {
    const state = makeCoopState(2)
    const p1 = P(state, 'p1')
    p1.hp = 0
    p1.eliminated = true
    // p2 hits 0 this tick → downs this tick → all players down → defeat this tick.
    state.players.get('p2')!.hp = 0

    const next = simulateTick(state, new Map(), mulberry32(1))

    expect(P(next, 'p2').downed).toBe(true)
    expect(next.result).toBe('defeated')
  })

  it('no defeat while at least one player is alive', () => {
    const state = makeCoopState(2)
    const p1 = P(state, 'p1')
    p1.hp = 0
    p1.downed = true
    p1.bleedOutRemainingMs = 20_000

    const next = simulateTick(state, new Map(), mulberry32(1))

    expect(next.result).toBeUndefined()
  })
})
