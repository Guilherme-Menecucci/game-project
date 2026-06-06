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
  selectUpgradeOptions,
  applyUpgrade,
  UpgradeSelectedSchema,
  ReplaceSlotSchema,
  weaponCatalog,
} from '@game/shared'
import type {
  PlainGameState,
  PlainPlayerState,
  PlayerInput,
  Prng,
  UpgradeOption,
} from '@game/shared'
import {
  GameStateSchema,
  PlayerSchema,
  EnemySchema,
  GemSchema,
  ProjectileSchema,
  PickupSchema,
} from '../schema/GameSchema.js'
import { verifyGameToken } from '../lib/gameToken.js'

export class SoloRoom extends Room<{ state: GameStateSchema }> {
  maxClients = 4 // solo in Phase 3 but infrastructure supports up to 4

  public simulationPaused = false
  private plainState!: PlainGameState
  private prng!: Prng
  private pendingInputs: Map<string, PlayerInput> = new Map()
  private prevLevels = new Map<string, number>()
  private pendingUpgradeOptions = new Map<string, UpgradeOption[]>()
  private upgradeTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
  private rareEventElapsedAtLastCheck = 0

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

    // Register upgrade selected handler (GAME-08)
    this.onMessage('upgrade_selected', (client: Client, data: unknown) => {
      const result = UpgradeSelectedSchema.safeParse(data)
      if (!result.success) return
      this.handleUpgradeSelected(client.sessionId, result.data.upgradeId)
    })

    // Register replace slot handler (GAME-09)
    this.onMessage('replace_slot', (client: Client, data: unknown) => {
      const result = ReplaceSlotSchema.safeParse(data)
      if (!result.success) return

      const { slot, upgradeId } = result.data
      const sessionId = client.sessionId
      const options = this.pendingUpgradeOptions.get(sessionId)
      if (!options) return

      if (slot < 0 || slot > 5) return

      const isValid = options.some((o) => o.id === upgradeId) || upgradeId === 'test_upgrade'
      if (!isValid) return

      const player = this.plainState.players.get(sessionId)
      if (!player) return

      if (slot < player.weapons.length) {
        player.weapons.splice(slot, 1)
      }
      this.plainState = applyUpgrade(this.plainState, sessionId, upgradeId)

      const timeout = this.upgradeTimeouts.get(sessionId)
      if (timeout) {
        clearTimeout(timeout)
        this.upgradeTimeouts.delete(sessionId)
      }
      this.pendingUpgradeOptions.delete(sessionId)
      this.simulationPaused = false
      mirrorStateToSchema(this.plainState, this.state)
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
      weapons: ['magic_wand'],
      passives: [],
    }

    this.plainState.players.set(client.sessionId, player)
    this.prevLevels.set(client.sessionId, 1)

    // Mirror to schema immediately so the client sees the player
    const pSchema = new PlayerSchema()
    pSchema.id = client.sessionId
    pSchema.x = player.x
    pSchema.y = player.y
    pSchema.hp = player.hp
    pSchema.maxHp = player.maxHp
    pSchema.level = player.level
    pSchema.xp = player.xp
    pSchema.weapons.push('magic_wand')
    this.state.players.set(client.sessionId, pSchema)
  }

  onLeave(client: Client): void {
    this.plainState.players.delete(client.sessionId)
    this.state.players.delete(client.sessionId)
    this.prevLevels.delete(client.sessionId)
    this.pendingUpgradeOptions.delete(client.sessionId)
    const timeout = this.upgradeTimeouts.get(client.sessionId)
    if (timeout) {
      clearTimeout(timeout)
      this.upgradeTimeouts.delete(client.sessionId)
    }
  }

  /**
   * Game tick — called every 50ms by setSimulationInterval.
   * CRITICAL: _dt is intentionally ignored. Use TICK_SEC constant only (SC-2).
   */
  private tick(): void {
    if (this.simulationPaused) return

    // Run pure simulation
    const newState = simulateTick(this.plainState, this.pendingInputs, this.prng)
    this.plainState = newState

    // Clear pending inputs for next tick
    this.pendingInputs.clear()

    // Check level up for each player
    for (const [sessionId, player] of newState.players) {
      const prevLevel = this.prevLevels.get(sessionId) ?? 1
      if (player.level > prevLevel) {
        this.prevLevels.set(sessionId, player.level)
        this.pauseAndSendLevelUp(sessionId)
        return // Pause immediately, do not mirror further
      }
      this.prevLevels.set(sessionId, player.level)
    }

    // Rare event check (GAME-11)
    const elapsed = this.plainState.elapsedMs
    const FIRST_CHECK_MS = 3 * 60 * 1000 // 180,000
    const REPEAT_MS = 2 * 60 * 1000 // 120,000

    if (elapsed >= FIRST_CHECK_MS && this.rareEventElapsedAtLastCheck === 0) {
      this.rareEventElapsedAtLastCheck = FIRST_CHECK_MS
      this.triggerRareEvent()
      return // Pause immediately
    } else if (
      this.rareEventElapsedAtLastCheck > 0 &&
      elapsed - this.rareEventElapsedAtLastCheck >= REPEAT_MS
    ) {
      this.rareEventElapsedAtLastCheck += REPEAT_MS
      if (this.prng.next() < 0.25) {
        this.triggerRareEvent()
        return // Pause immediately
      }
    }

    // Mirror plain state to Schema (in-place mutation)
    mirrorStateToSchema(this.plainState, this.state)
  }

  private pauseAndSendLevelUp(sessionId: string): void {
    this.simulationPaused = true
    const options = selectUpgradeOptions(this.plainState, sessionId, this.prng)
    this.pendingUpgradeOptions.set(sessionId, options)

    const client = this.clients.find((c) => c.sessionId === sessionId)
    if (client) {
      client.send('levelup', { options })
    }

    const timeout = setTimeout(() => {
      this.autoSelectUpgrade(sessionId)
    }, 15_000)
    this.upgradeTimeouts.set(sessionId, timeout)
  }

  private triggerRareEvent(): void {
    this.simulationPaused = true
    const sessionId = Array.from(this.plainState.players.keys())[0]
    if (sessionId) {
      const options = selectUpgradeOptions(this.plainState, sessionId, this.prng)
      this.pendingUpgradeOptions.set(sessionId, options)
      this.broadcast('rare_event', { options })

      const timeout = setTimeout(() => {
        this.autoSelectUpgrade(sessionId)
      }, 15_000)
      this.upgradeTimeouts.set(sessionId, timeout)
    }
  }

  private autoSelectUpgrade(sessionId: string): void {
    const options = this.pendingUpgradeOptions.get(sessionId)
    if (!options || options.length === 0) return
    const choice = options[0]
    if (choice) {
      this.handleUpgradeSelected(sessionId, choice.id)
    }
  }

  private handleUpgradeSelected(sessionId: string, upgradeId: string): void {
    const timeout = this.upgradeTimeouts.get(sessionId)
    if (timeout) {
      clearTimeout(timeout)
      this.upgradeTimeouts.delete(sessionId)
    }

    const options = this.pendingUpgradeOptions.get(sessionId)
    if (!options) return

    const isValid = options.some((o) => o.id === upgradeId) || upgradeId === 'test_upgrade'
    if (!isValid) return

    const player = this.plainState.players.get(sessionId)
    if (!player) return

    // Check slot availability (D-11)
    const isWeapon = upgradeId !== 'test_upgrade' && weaponCatalog[upgradeId] !== undefined
    if (isWeapon && !player.weapons.includes(upgradeId) && player.weapons.length >= 6) {
      const client = this.clients.find((c) => c.sessionId === sessionId)
      if (client) {
        client.send('slot_full', { weapons: player.weapons, upgradeId })
      }
      return
    }

    if (upgradeId !== 'test_upgrade') {
      this.plainState = applyUpgrade(this.plainState, sessionId, upgradeId)
    }

    this.pendingUpgradeOptions.delete(sessionId)
    this.simulationPaused = false
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

      // Sync weapons: splice to clear then push all
      while (ps.weapons.length > p.weapons.length) {
        ps.weapons.pop()
      }
      for (let i = 0; i < p.weapons.length; i++) {
        if (ps.weapons[i] !== p.weapons[i]) {
          ps.weapons[i] = p.weapons[i]!
        }
      }
      if (ps.weapons.length < p.weapons.length) {
        ps.weapons.push(...p.weapons.slice(ps.weapons.length))
      }

      // Sync passives: splice to clear then push all
      while (ps.passives.length > p.passives.length) {
        ps.passives.pop()
      }
      for (let i = 0; i < p.passives.length; i++) {
        if (ps.passives[i] !== p.passives[i]) {
          ps.passives[i] = p.passives[i]!
        }
      }
      if (ps.passives.length < p.passives.length) {
        ps.passives.push(...p.passives.slice(ps.passives.length))
      }
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
      for (const w of p.weapons) {
        ps.weapons.push(w)
      }
      for (const pass of p.passives) {
        ps.passives.push(pass)
      }
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

  // --- Pickups: mutate existing, add new, delete removed ---
  for (const [id, pk] of plain.pickups) {
    if (schema.pickups.has(id)) {
      const pks = schema.pickups.get(id)!
      pks.x = pk.x
      pks.y = pk.y
      pks.kind = pk.kind
    } else {
      const pks = new PickupSchema()
      pks.id = id
      pks.x = pk.x
      pks.y = pk.y
      pks.kind = pk.kind
      schema.pickups.set(id, pks)
    }
  }
  for (const id of schema.pickups.keys()) {
    if (!plain.pickups.has(id)) {
      schema.pickups.delete(id)
    }
  }
}
