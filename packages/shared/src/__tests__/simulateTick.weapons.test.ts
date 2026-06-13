/**
 * simulateTick weapons tests (GAME-03, GAME-05, GAME-06, GAME-07)
 *
 * Verifies: auto-fire, projectile collision, gem drop/collection, XP/leveling,
 * enemy contact damage, game-over path, ranged AI, enemy fire, enemy projectile damage.
 *
 * All tests depend on weapons.ts functions being wired into simulateTick.
 *
 * RED phase: all tests fail — weapons.ts not yet implemented.
 * GREEN phase: plan 03-06 implements weapons.ts and wires into simulateTick.
 */
import { describe, it, expect } from 'vitest'
import {
  simulateTick,
  makeInitialState,
  mulberry32,
  AUTO_FIRE_INTERVAL_TICKS,
  ENEMY_FIRE_INTERVAL_TICKS,
  XP_LEVEL_THRESHOLD,
  GEM_COLLECT_SNAP,
  KEEP_DISTANCE_INNER,
  getXpThresholdForLevel,
} from '@game/shared'
import type { PlainEnemyState, PlainGameState, PlainProjectileState } from '@game/shared'

// Helper: set player at a specific position
function setPlayer(state: PlainGameState, x: number, y: number, hp = 10): PlainGameState {
  const [playerId] = [...state.players.keys()]
  const player = state.players.get(playerId)!
  player.x = x
  player.y = y
  player.hp = hp
  player.maxHp = hp
  player.xp = 0
  player.level = 1
  return state
}

// Helper: add an enemy at position with given archetype
function addEnemy(
  state: PlainGameState,
  id: string,
  x: number,
  y: number,
  archetype: 'swarmer' | 'tank' | 'ranged' = 'swarmer',
  hp = 1
): PlainGameState {
  const enemy: PlainEnemyState = {
    id,
    x,
    y,
    hp,
    maxHp: hp,
    archetype,
    speed: 7_500,
    lastFireTick: 0,
  }
  state.enemies.set(id, enemy)
  return state
}

// Helper: add a projectile at position
function addProjectile(
  state: PlainGameState,
  id: string,
  x: number,
  y: number,
  isEnemy: boolean,
  damage = 1,
  vx = 0,
  vy = 0,
  lifetime = 100
): PlainGameState {
  const proj: PlainProjectileState = {
    id,
    x,
    y,
    vx,
    vy,
    ownerId: isEnemy ? 'enemy-1' : 'p1',
    isEnemy,
    damage,
    lifetime,
  }
  state.projectiles.set(id, proj)
  return state
}

describe('simulateTick weapons (GAME-03, GAME-05, GAME-06, GAME-07)', () => {
  /**
   * Test 1: auto-fire spawns player projectile toward nearest enemy
   * AUTO_FIRE_INTERVAL_TICKS = 20; tick is incremented in simulateTick, so
   * set state.tick = AUTO_FIRE_INTERVAL_TICKS - 1 so after increment tick == 20
   * and (20 % 20) === 0.
   */
  it('auto-fire: player projectile spawns toward nearest enemy on fire tick', () => {
    const state = makeInitialState(1)
    const playerX = 2_000_000
    const playerY = 2_000_000
    setPlayer(state, playerX, playerY)
    state.players.get('p1')!.weapons = ['magic_wand:3']

    // Enemy 100 game units east of player
    const enemyX = playerX + 100_000
    addEnemy(state, 'e1', enemyX, playerY)

    // After simulateTick increments, tick will be AUTO_FIRE_INTERVAL_TICKS
    state.tick = AUTO_FIRE_INTERVAL_TICKS - 1

    const inputs = new Map()
    const prng = mulberry32(1)
    const nextState = simulateTick(state, inputs, prng)

    const playerProjectiles = [...nextState.projectiles.values()].filter((p) => p.isEnemy === false)
    expect(playerProjectiles.length).toBeGreaterThanOrEqual(1)

    // Projectile should be aimed east (toward enemy east of player)
    const proj = playerProjectiles[0]!
    expect(proj.vx).toBeGreaterThan(0)
  })

  /**
   * Test 2: projectile hits enemy — enemy removed, gem dropped at enemy death position.
   * The enemy AI moves before collision, so the gem drops at the enemy's post-move position.
   * We verify: enemy removed, gem exists, gem is near the original enemy position (within
   * one tick of enemy movement — swarmer speed 7,500 sub-units).
   */
  it('projectile hits enemy: enemy removed, gem dropped at enemy position', () => {
    const state = makeInitialState(1)
    const playerX = 2_000_000
    const playerY = 2_000_000
    setPlayer(state, playerX, playerY)

    const enemyX = 2_200_000
    const enemyY = 2_000_000
    addEnemy(state, 'e1', enemyX, enemyY, 'swarmer', 1)

    // Place player projectile at enemy position with vx=vy=0.
    // applyEnemyAI moves the enemy before applyCollisions runs, so the projectile
    // is placed at the enemy's current position. The grid query still finds the
    // moved enemy because the projectile doesn't move (vx=vy=0).
    // Use a generous hit radius by placing the projectile at the enemy spawn point —
    // the swarmer moves toward player (west, ~7,500 sub-units), so the final enemy
    // position is still within PROJECTILE_HIT_RADIUS (8,000 sub-units) of enemyX.
    addProjectile(state, 'proj1', enemyX, enemyY, false, 1, 0, 0, 100)

    const inputs = new Map()
    const prng = mulberry32(1)
    const nextState = simulateTick(state, inputs, prng)

    expect(nextState.enemies.size).toBe(0)
    expect(nextState.gems.size).toBe(1)

    // Gem drops at enemy's position at time of death (after AI move)
    const gem = [...nextState.gems.values()][0]!
    // Gem should be near the original enemy position (within swarmer speed = 7,500 sub-units)
    const dx = Math.abs(gem.x - enemyX)
    const dy = Math.abs(gem.y - enemyY)
    expect(dx).toBeLessThanOrEqual(10_000)
    expect(dy).toBeLessThanOrEqual(10_000)
  })

  /**
   * Test 3: gem auto-collected — XP added to player
   * Gem within GEM_COLLECT_SNAP (10,000 sub-units) of player → collected in one tick.
   */
  it('gem auto-collected: xp added to player', () => {
    const state = makeInitialState(1)
    const playerX = 2_000_000
    const playerY = 2_000_000
    setPlayer(state, playerX, playerY)

    // Place gem within snap radius
    const gemX = playerX + GEM_COLLECT_SNAP - 1_000
    const gemY = playerY
    const gemValue = 2
    state.gems.set('gem1', { id: 'gem1', x: gemX, y: gemY, value: gemValue })

    const inputs = new Map()
    const prng = mulberry32(1)
    const nextState = simulateTick(state, inputs, prng)

    const [playerId] = [...nextState.players.keys()]
    const player = nextState.players.get(playerId)!
    expect(player.xp).toBe(gemValue)
    expect(nextState.gems.size).toBe(0)
  })

  /**
   * Test 4: player levels up at XP_LEVEL_THRESHOLD
   * Set player xp = threshold - 1, collect a gem with value=1 → level up.
   */
  it('player levels up at XP threshold', () => {
    const state = makeInitialState(1)
    const playerX = 2_000_000
    const playerY = 2_000_000
    setPlayer(state, playerX, playerY)

    // Set player xp just below threshold
    const [playerId] = [...state.players.keys()]
    const player = state.players.get(playerId)!
    player.xp = XP_LEVEL_THRESHOLD - 1

    // Place gem within snap radius with value=1
    const gemX = playerX + GEM_COLLECT_SNAP - 1_000
    state.gems.set('gem1', { id: 'gem1', x: gemX, y: playerY, value: 1 })

    const inputs = new Map()
    const prng = mulberry32(1)
    const nextState = simulateTick(state, inputs, prng)

    const nextPlayer = nextState.players.get(playerId)!
    expect(nextPlayer.level).toBe(2)
    expect(nextPlayer.xp).toBe(0)
  })

  /**
   * Test 5: enemy contact reduces player HP
   * Place swarmer enemy overlapping player (distance < ENEMY_CONTACT_RADIUS).
   */
  it('enemy contact reduces player HP', () => {
    const state = makeInitialState(1)
    const playerX = 2_000_000
    const playerY = 2_000_000
    setPlayer(state, playerX, playerY, 10)

    // Enemy at player position (distance = 0 < ENEMY_CONTACT_RADIUS)
    addEnemy(state, 'e1', playerX, playerY, 'swarmer', 100)

    const inputs = new Map()
    const prng = mulberry32(1)
    const nextState = simulateTick(state, inputs, prng)

    const [playerId] = [...nextState.players.keys()]
    const player = nextState.players.get(playerId)!
    expect(player.hp).toBeLessThan(10)
  })

  /**
   * Test 6: player HP reaches 0 and does not go negative
   * Set player.hp = 1; enemy overlapping → HP clamps at 0.
   */
  it('player HP reaches 0: player.hp === 0 and does not go negative', () => {
    const state = makeInitialState(1)
    const playerX = 2_000_000
    const playerY = 2_000_000
    setPlayer(state, playerX, playerY, 1)

    // Enemy at player position, deals contact damage
    addEnemy(state, 'e1', playerX, playerY, 'swarmer', 100)

    const inputs = new Map()

    // Advance multiple ticks
    let currentState = state
    for (let i = 0; i < 5; i++) {
      currentState = simulateTick(currentState, inputs, mulberry32(1 + i))
    }

    const [playerId] = [...currentState.players.keys()]
    const player = currentState.players.get(playerId)!
    expect(player.hp).toBe(0)
  })

  /**
   * Test 7: determinism preserved — simulateTick byte-identical with combat
   */
  it('determinism preserved: simulateTick still byte-identical with combat', () => {
    const state1 = makeInitialState(42)
    const state2 = makeInitialState(42)

    // Add enemies to both
    for (const state of [state1, state2]) {
      addEnemy(state, 'e1', 2_100_000, 2_000_000)
      addEnemy(state, 'e2', 1_900_000, 2_000_000)
    }

    const result1 = simulateTick(state1, new Map(), mulberry32(42))
    const result2 = simulateTick(state2, new Map(), mulberry32(42))

    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2))
  })

  /**
   * Test 8: ranged keep-distance — moves AWAY from player when too close
   * Enemy at KEEP_DISTANCE_INNER - 10,000 sub-units east of player → moves further east.
   * Set tick to non-fire tick to isolate movement.
   */
  it('ranged keep-distance: moves away when distance < KEEP_DISTANCE_INNER (GAME-05)', () => {
    const state = makeInitialState(1)
    const playerX = 2_000_000
    const playerY = 2_000_000
    setPlayer(state, playerX, playerY)

    // Enemy 110,000 sub-units east (inside KEEP_DISTANCE_INNER = 120,000)
    const enemyX = playerX + KEEP_DISTANCE_INNER - 10_000 // 110,000
    const enemy: PlainEnemyState = {
      id: 'ranged-1',
      x: enemyX,
      y: playerY,
      hp: 20,
      maxHp: 20,
      archetype: 'ranged',
      speed: 7_500,
      lastFireTick: 0,
    }
    state.enemies.set('ranged-1', enemy)

    // Set tick=1 so after increment = 2, which is not a fire tick (2 - 0 = 2 < 20)
    state.tick = 1

    const inputs = new Map()
    const prng = mulberry32(1)
    const nextState = simulateTick(state, inputs, prng)

    const nextEnemy = nextState.enemies.get('ranged-1')!
    // Enemy should move EAST (away from player who is west of it)
    expect(nextEnemy.x).toBeGreaterThan(enemyX)
  })

  /**
   * Test 9: ranged enemy fires isEnemy:true projectile at fire interval
   * Enemy in fire band (between KEEP_DISTANCE_INNER and KEEP_DISTANCE_OUTER).
   * lastFireTick=0, tick increments to ENEMY_FIRE_INTERVAL_TICKS → fire check passes.
   */
  it('ranged enemy fires projectile at player (GAME-05)', () => {
    const state = makeInitialState(1)
    const playerX = 2_000_000
    const playerY = 2_000_000
    setPlayer(state, playerX, playerY)

    // Enemy in fire band: 140,000 east (between 120k inner and 160k outer)
    const enemyX = playerX + 140_000
    const enemy: PlainEnemyState = {
      id: 'ranged-1',
      x: enemyX,
      y: playerY,
      hp: 20,
      maxHp: 20,
      archetype: 'ranged',
      speed: 7_500,
      lastFireTick: 0,
    }
    state.enemies.set('ranged-1', enemy)

    // Set tick = ENEMY_FIRE_INTERVAL_TICKS so after increment, tick-1 = ENEMY_FIRE_INTERVAL_TICKS
    // After increment: tick = ENEMY_FIRE_INTERVAL_TICKS + 1
    // Fire check: tick - lastFireTick = (ENEMY_FIRE_INTERVAL_TICKS + 1) - 0 >= ENEMY_FIRE_INTERVAL_TICKS ✓
    // But ranged.behavior.test.ts sets state.tick = ENEMY_FIRE_INTERVAL_TICKS and expects fire...
    // That test: state.tick = 20, after increment = 21; 21 - 0 = 21 >= 20 ✓
    // So we match: set state.tick = ENEMY_FIRE_INTERVAL_TICKS - 1 → tick becomes 20, 20-0=20 >= 20
    state.tick = ENEMY_FIRE_INTERVAL_TICKS - 1

    const inputs = new Map()
    const prng = mulberry32(1)
    const nextState = simulateTick(state, inputs, prng)

    const hasEnemyProjectile = [...nextState.projectiles.values()].some((p) => p.isEnemy === true)
    expect(hasEnemyProjectile).toBe(true)

    // Projectile should aim toward player (enemy is east, so vx < 0)
    const enemyProj = [...nextState.projectiles.values()].find((p) => p.isEnemy === true)!
    expect(enemyProj.vx).toBeLessThan(0)
  })

  /**
   * Test 10: enemy projectile damages player on hit
   * Place enemy projectile at player position (vx=vy=0 → no movement before collision).
   */
  it('enemy projectile damages player on hit', () => {
    const state = makeInitialState(1)
    const playerX = 2_000_000
    const playerY = 2_000_000
    setPlayer(state, playerX, playerY, 10)

    // Enemy projectile at player position with zero velocity
    addProjectile(state, 'eproj1', playerX, playerY, true, 2, 0, 0, 60)

    const inputs = new Map()
    const prng = mulberry32(1)
    const nextState = simulateTick(state, inputs, prng)

    const [playerId] = [...nextState.players.keys()]
    const player = nextState.players.get(playerId)!
    expect(player.hp).toBeLessThan(10)

    // Enemy projectile should be removed after hit
    const hasEnemyProjectile = [...nextState.projectiles.values()].some((p) => p.isEnemy === true)
    expect(hasEnemyProjectile).toBe(false)
  })

  /**
   * Test 11: getXpThresholdForLevel progressive scaling multipliers
   */
  it('getXpThresholdForLevel scales thresholds progressively', () => {
    // Level 1: 1x (base 10)
    expect(getXpThresholdForLevel(1)).toBe(10)
    // Level 2: 1.002x
    expect(getXpThresholdForLevel(2)).toBe(10) // 10 * 1.002 = 10.02 -> 10
    // Level 3: 1.005x
    expect(getXpThresholdForLevel(3)).toBe(10) // 10 * 1.005 = 10.05 -> 10
    // Higher levels should be progressively larger
    expect(getXpThresholdForLevel(100)).toBeGreaterThan(10)
    expect(getXpThresholdForLevel(255)).toBeGreaterThan(getXpThresholdForLevel(100))
  })

  /**
   * Test 12: Player level does not wrap around at 255
   */
  it('player level transitions past 255 without wrapping to 0', () => {
    const state = makeInitialState(1)
    const playerX = 2_000_000
    const playerY = 2_000_000
    setPlayer(state, playerX, playerY)

    const [playerId] = [...state.players.keys()]
    const player = state.players.get(playerId)!
    player.level = 255

    const threshold = getXpThresholdForLevel(255)
    player.xp = threshold - 1

    // Place gem within snap radius with value=2 to trigger level up to 256
    const gemX = playerX + GEM_COLLECT_SNAP - 1_000
    state.gems.set('gem1', { id: 'gem1', x: gemX, y: playerY, value: 2 })

    const inputs = new Map()
    const prng = mulberry32(1)
    const nextState = simulateTick(state, inputs, prng)

    const nextPlayer = nextState.players.get(playerId)!
    expect(nextPlayer.level).toBe(256)
    expect(nextPlayer.xp).toBe(1)
  })
})
