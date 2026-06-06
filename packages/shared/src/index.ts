// @game/shared — public API
// Phase 3 will expand PlayerInputSchema with seq and tick fields.
// Use z.object (not z.tuple) to allow adding fields without breaking the import contract.
import * as z from 'zod'

// Game input schemas (Phase 1)
export const PlayerInputSchema = z.object({
  moveVector: z.object({
    x: z.number(),
    y: z.number(),
  }),
  aimAngle: z.number(),
  actionFlags: z.number().int(),
  // D-02: Anti-replay sequence number — monotone per client connection.
  // Optional in Phase 3 for backward compat; will be required in Phase 4.
  seq: z.number().int().min(0).optional(),
  // D-02: Server tick reference — ties input snapshot to the authoritative tick.
  // Optional in Phase 3 for backward compat; will be required in Phase 4.
  tick: z.number().int().min(0).optional(),
})

export type PlayerInput = z.infer<typeof PlayerInputSchema>

// Auth schemas (Phase 2)
export const LoginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
})
export type Login = z.infer<typeof LoginSchema>

export const RegisterSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(72),
})
export type Register = z.infer<typeof RegisterSchema>

export const GuestTokenResponseSchema = z.object({
  userId: z.uuid(),
  isGuest: z.literal(true),
  displayName: z.string(),
})
export type GuestTokenResponse = z.infer<typeof GuestTokenResponseSchema>

// ─── Phase 3 types ────────────────────────────────────────────────────────────

export type PlainPlayerState = {
  id: string
  x: number
  y: number
  hp: number
  maxHp: number
  level: number
  xp: number
  speed: number
}

export type PlainEnemyState = {
  id: string
  x: number
  y: number
  hp: number
  maxHp: number
  archetype: 'swarmer' | 'tank' | 'ranged'
  speed: number
  lastFireTick: number
}

export type PlainGemState = {
  id: string
  x: number
  y: number
  value: number
}

export type PlainProjectileState = {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  ownerId: string
  isEnemy: boolean
  damage: number
  lifetime: number
}

export type PlainGameState = {
  tick: number
  elapsedMs: number
  players: Map<string, PlainPlayerState>
  enemies: Map<string, PlainEnemyState>
  gems: Map<string, PlainGemState>
  projectiles: Map<string, PlainProjectileState>
  prngSeed: number
}

export type Prng = {
  next: () => number
  state: () => number
}

/**
 * mulberry32 — fast seeded PRNG returning values in [0, 1).
 * Stub: throws 'not implemented' until plan 03-02 implements it.
 */
export function mulberry32(seed: number): Prng {
  void seed
  throw new Error('not implemented')
}

/**
 * UniformGrid — spatial hash grid for O(n) collision broadphase.
 * Stub: all methods throw 'not implemented' until plan 03-02.
 */
export class UniformGrid {
  insert(id: string, x: number, y: number): void {
    void id
    void x
    void y
    throw new Error('not implemented')
  }
  queryRadius(x: number, y: number, radius: number): string[] {
    void x
    void y
    void radius
    throw new Error('not implemented')
  }
  clear(): void {
    throw new Error('not implemented')
  }
}

/**
 * makeInitialState — creates a fresh PlainGameState for a run.
 * Stub: throws 'not implemented' until plan 03-02.
 */
export function makeInitialState(prngSeed: number): PlainGameState {
  void prngSeed
  throw new Error('not implemented')
}

/**
 * simulateTick — pure deterministic tick function.
 * Stub: throws 'not implemented' until plan 03-02.
 */
export function simulateTick(
  state: PlainGameState,
  inputs: Map<string, PlayerInput>,
  prng: Prng
): PlainGameState {
  void state
  void inputs
  void prng
  throw new Error('not implemented')
}

/**
 * spawnEnemies — applies spawn curve logic and adds enemies to state.
 * Stub: throws 'not implemented' until plan 03-03.
 */
export function spawnEnemies(state: PlainGameState, prng: Prng): PlainGameState {
  void state
  void prng
  throw new Error('not implemented')
}
