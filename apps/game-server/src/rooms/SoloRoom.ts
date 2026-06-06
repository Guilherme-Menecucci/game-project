/**
 * SoloRoom — thin adapter over simulateTick.
 *
 * Responsibilities:
 * - Validate game JWT in static onAuth (T-3-03)
 * - Accept only PlayerInputSchema-valid input messages (T-3-04)
 * - Call simulateTick every 50ms using TICK_SEC constant (never _dt)
 * - Mirror PlainGameState into Colyseus Schema in-place for delta encoding
 *
 * Pattern 2 from 03-RESEARCH.md: Room is a thin adapter; no game logic here.
 * All game physics live in @game/shared simulateTick (pure function).
 */
import { Room } from '@colyseus/core'
import type { Client } from '@colyseus/core'
import {
  simulateTick,
  makeInitialState,
  mulberry32,
  PlayerInputSchema,
  TICK_SEC,
  WORLD_W,
  WORLD_H,
} from '@game/shared'
import type { PlainGameState, PlainPlayerState, PlayerInput, Prng } from '@game/shared'
import {
  GameStateSchema,
  PlayerSchema,
  EnemySchema,
  GemSchema,
  ProjectileSchema,
} from '../schema/GameSchema.js'
import { verifyGameToken } from '../lib/gameToken.js'

export class SoloRoom extends Room<{ state: GameStateSchema }> {
  maxClients = 4 // solo in Phase 3 but infrastructure supports up to 4

  private plainState!: PlainGameState
  private prng!: Prng
  private pendingInputs: Map<string, PlayerInput> = new Map()

  onCreate(): void {
    this.setState(new GameStateSchema())

    // makeInitialState seeds one player 'p1' for @game/shared movement tests.
    // SoloRoom must clear that phantom player so the Schema only tracks real clients.
    this.plainState = makeInitialState(Date.now())
    this.plainState.players.clear()

    this.prng = mulberry32(Date.now())
    this.pendingInputs = new Map()

    // 20Hz fixed tick — setSimulationInterval calls this.tick every 50ms.
    // TICK_SEC * 1000 = 50ms interval. _dt is ignored for determinism (SC-2).
    this.setSimulationInterval((dt: number) => {
      void dt
      this.tick()
    }, TICK_SEC * 1000)

    // Register input message handler (T-3-04)
    this.onMessage('input', (client: Client, data: unknown) => {
      const result = PlayerInputSchema.safeParse(data)
      if (!result.success) return // silently drop invalid input
      this.pendingInputs.set(client.sessionId, result.data)
    })

    // Wildcard handler: silently drop unknown message types (SC-4 anti-cheat).
    // Without this, Colyseus default behavior disconnects the client for unknown
    // message types in non-devMode, which is a DoS vector.
    // Any message type not explicitly handled above is silently ignored.
    this.onMessage('*', (client: Client, type: string | number, data: unknown) => {
      // Intentionally empty — unknown messages are silently dropped (SC-4 anti-cheat)
      void client
      void type
      void data
    })
  }

  /**
   * Static onAuth — validates the game JWT from context.token (T-3-03).
   *
   * Signature per @colyseus/core@0.17.42 Room.d.ts:
   *   static onAuth(token: string, options: any, context: AuthContext): Promise<unknown>
   *
   * The first parameter is a bare string (unused here — context.token is preferred).
   * context.token is populated from _authToken query param (set via sdk.auth.token)
   * or from Authorization: Bearer header.
   *
   * Throws on invalid/expired tokens — Colyseus rejects the client connection.
   */
  static async onAuth(
    token: string,
    options: { token?: string },
    context: { token?: string }
  ): Promise<{ userId: string }> {
    const authToken = context.token ?? options?.token ?? token
    if (!authToken) {
      throw new Error('Missing game token')
    }
    const payload = verifyGameToken(authToken)
    return { userId: payload.userId }
  }

  onJoin(client: Client): void {
    // Add player to plain state at world center
    const centerX = Math.floor(WORLD_W / 2)
    const centerY = Math.floor(WORLD_H / 2)

    const player: PlainPlayerState = {
      id: client.sessionId,
      x: centerX,
      y: centerY,
      hp: 100,
      maxHp: 100,
      level: 1,
      xp: 0,
      speed: 10_000,
      weapons: [],
      passives: [],
    }

    this.plainState.players.set(client.sessionId, player)

    // Mirror to schema immediately so the client sees the player
    const pSchema = new PlayerSchema()
    pSchema.id = client.sessionId
    pSchema.x = player.x
    pSchema.y = player.y
    pSchema.hp = player.hp
    pSchema.maxHp = player.maxHp
    pSchema.level = player.level
    pSchema.xp = player.xp
    this.state.players.set(client.sessionId, pSchema)
  }

  onLeave(client: Client): void {
    this.plainState.players.delete(client.sessionId)
    this.state.players.delete(client.sessionId)
  }

  /**
   * Game tick — called every 50ms by setSimulationInterval.
   * CRITICAL: _dt is intentionally ignored. Use TICK_SEC constant only (SC-2).
   */
  private tick(): void {
    // Run pure simulation
    const newState = simulateTick(this.plainState, this.pendingInputs, this.prng)
    this.plainState = newState

    // Clear pending inputs for next tick
    this.pendingInputs.clear()

    // Mirror plain state to Schema (in-place mutation)
    mirrorStateToSchema(this.plainState, this.state)
  }
}

/**
 * Mirror PlainGameState fields into the Colyseus GameStateSchema.
 *
 * CRITICAL: Always mutate existing Schema instances in-place.
 * Never replace MapSchema references — Colyseus delta encoder tracks the instance.
 * Replacing schema.players = new MapSchema() triggers full re-encode, not delta.
 */
function mirrorStateToSchema(plain: PlainGameState, schema: GameStateSchema): void {
  schema.tick = plain.tick
  schema.elapsedMs = plain.elapsedMs

  // --- Players: mutate existing, add new, delete removed ---
  for (const [id, p] of plain.players) {
    if (schema.players.has(id)) {
      // Mutate existing instance in-place (delta encoding preserves only changed fields)
      const ps = schema.players.get(id)!
      ps.x = p.x
      ps.y = p.y
      ps.hp = p.hp
      ps.maxHp = p.maxHp
      ps.level = p.level
      ps.xp = p.xp
    } else {
      // Add new player
      const ps = new PlayerSchema()
      ps.id = id
      ps.x = p.x
      ps.y = p.y
      ps.hp = p.hp
      ps.maxHp = p.maxHp
      ps.level = p.level
      ps.xp = p.xp
      schema.players.set(id, ps)
    }
  }
  // Delete players not in plain state
  for (const id of schema.players.keys()) {
    if (!plain.players.has(id)) {
      schema.players.delete(id)
    }
  }

  // --- Enemies: mutate existing, add new, delete removed ---
  for (const [id, e] of plain.enemies) {
    if (schema.enemies.has(id)) {
      const es = schema.enemies.get(id)!
      es.x = e.x
      es.y = e.y
      es.hp = e.hp
      es.archetype = e.archetype
    } else {
      const es = new EnemySchema()
      es.id = id
      es.x = e.x
      es.y = e.y
      es.hp = e.hp
      es.archetype = e.archetype
      schema.enemies.set(id, es)
    }
  }
  for (const id of schema.enemies.keys()) {
    if (!plain.enemies.has(id)) {
      schema.enemies.delete(id)
    }
  }

  // --- Gems: mutate existing, add new, delete removed ---
  for (const [id, g] of plain.gems) {
    if (schema.gems.has(id)) {
      const gs = schema.gems.get(id)!
      gs.x = g.x
      gs.y = g.y
      gs.value = g.value
    } else {
      const gs = new GemSchema()
      gs.id = id
      gs.x = g.x
      gs.y = g.y
      gs.value = g.value
      schema.gems.set(id, gs)
    }
  }
  for (const id of schema.gems.keys()) {
    if (!plain.gems.has(id)) {
      schema.gems.delete(id)
    }
  }

  // --- Projectiles: mutate existing, add new, delete removed ---
  for (const [id, pr] of plain.projectiles) {
    if (schema.projectiles.has(id)) {
      const prs = schema.projectiles.get(id)!
      prs.x = pr.x
      prs.y = pr.y
      prs.isEnemy = pr.isEnemy
    } else {
      const prs = new ProjectileSchema()
      prs.id = id
      prs.x = pr.x
      prs.y = pr.y
      prs.isEnemy = pr.isEnemy
      schema.projectiles.set(id, prs)
    }
  }
  for (const id of schema.projectiles.keys()) {
    if (!plain.projectiles.has(id)) {
      schema.projectiles.delete(id)
    }
  }
}
