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
  characterCatalog,
  CharacterSelectSchema,
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
  BossSchema,
  WeaponStatsSchema,
} from '../schema/GameSchema.js'
import { verifyGameToken } from '../lib/gameToken.js'

export class SoloRoom extends Room<{ state: GameStateSchema }> {
  // A solo room holds exactly one player. maxClients=1 is the security invariant:
  // it leaves no free seat for a crafted client to match into via join('solo_room')
  // by name, and forces joinOrCreate to always create a fresh room. Multiplayer
  // (2–4 players) is a separate room config in Phase 6 — never widen this one.
  maxClients = 1

  public simulationPaused = false
  private plainState!: PlainGameState
  private prng!: Prng
  private pendingInputs: Map<string, PlayerInput> = new Map()
  private prevLevels = new Map<string, number>()
  private pendingUpgradeOptions = new Map<string, UpgradeOption[]>()
  private upgradeTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
  private rareEventElapsedAtLastCheck = 0

  // Per-connection WS message rate limiting (PITFALLS S4) — 1s sliding window.
  // Legitimate clients send input at 20Hz (~20 msg/s); SOFT silently drops
  // floods, HARD disconnects egregious abuse. Wall-clock based and intentionally
  // OUTSIDE the deterministic simulation (does not affect simulateTick output).
  private static readonly RATE_WINDOW_MS = 1000
  private static readonly RATE_SOFT_LIMIT = 60
  private static readonly RATE_HARD_LIMIT = 200
  private messageRate = new Map<string, { count: number; windowStart: number }>()

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
      if (!this.allowMessage(client)) return // WS rate limit (T-3-DoS / PITFALLS S4)
      const result = PlayerInputSchema.safeParse(data)
      if (!result.success) return // silently drop invalid input
      this.pendingInputs.set(client.sessionId, result.data)
    })

    // Register upgrade selected handler (GAME-08)
    this.onMessage('upgrade_selected', (client: Client, data: unknown) => {
      if (!this.allowMessage(client)) return // WS rate limit (T-3-DoS / PITFALLS S4)
      const result = UpgradeSelectedSchema.safeParse(data)
      if (!result.success) return
      this.handleUpgradeSelected(client.sessionId, result.data.upgradeId)
    })

    // Register replace slot handler (GAME-09)
    this.onMessage('replace_slot', (client: Client, data: unknown) => {
      if (!this.allowMessage(client)) return // WS rate limit (T-3-DoS / PITFALLS S4)
      const result = ReplaceSlotSchema.safeParse(data)
      if (!result.success) return

      const { slot, upgradeId } = result.data
      const sessionId = client.sessionId
      const options = this.pendingUpgradeOptions.get(sessionId)
      if (!options) return

      if (slot < 0 || slot > 5) return

      // Only weapon-kind upgrades may replace a weapon slot (WR-01 security fix).
      // Passives and evolutions offered this level-up must not corrupt the weapons array.
      const isDev = process.env['NODE_ENV'] !== 'production'
      const selectedOption = options.find((o) => o.id === upgradeId)
      if (!selectedOption || selectedOption.kind !== 'weapon') {
        if (!(isDev && upgradeId === 'test_upgrade')) return
      }
      const isValid = !!selectedOption || (isDev && upgradeId === 'test_upgrade')
      if (!isValid) return

      const player = this.plainState.players.get(sessionId)
      if (!player) return

      if (slot < player.weapons.length) {
        // In-place slot replacement (T-05-12 / D-21): assign directly to preserve
        // slot-index alignment of weaponStats. The old splice+applyUpgrade pattern
        // shifted every subsequent slot down by one, corrupting weaponStats keys.
        player.weapons[slot] = upgradeId
        // Reset weaponStats for the replaced slot so DPS tracking restarts fresh
        if (!player.weaponStats) player.weaponStats = {}
        player.weaponStats[String(slot)] = {
          totalDamage: 0,
          acquiredAtMs: this.plainState.elapsedMs,
        }

        // Sync the in-place change onto the schema immediately (before mirrorStateToSchema)
        const pSchema = this.state.players.get(sessionId)
        if (pSchema) {
          if (pSchema.weapons.length > slot) {
            pSchema.weapons[slot] = upgradeId
          } else {
            pSchema.weapons.push(upgradeId)
          }
          // Replace schema weaponStats at this slot with a fresh instance
          const ws = new WeaponStatsSchema()
          ws.totalDamage = 0
          ws.acquiredAtMs = this.plainState.elapsedMs
          pSchema.weaponStats.set(String(slot), ws)
        }
      } else {
        // Slot does not exist yet (slot === player.weapons.length) — treat as append
        this.plainState = applyUpgrade(this.plainState, sessionId, upgradeId)
      }

      const timeout = this.upgradeTimeouts.get(sessionId)
      if (timeout) {
        clearTimeout(timeout)
        this.upgradeTimeouts.delete(sessionId)
      }
      this.pendingUpgradeOptions.delete(sessionId)
      this.simulationPaused = false
      mirrorStateToSchema(this.plainState, this.state)
      client.send('upgrade_applied', { upgradeId })
    })

    // Wildcard handler: silently drop unknown message types (SC-4 anti-cheat).
    // Without this, Colyseus default behavior disconnects the client for unknown
    // message types in non-devMode, which is a DoS vector.
    // Any message type not explicitly handled above is silently ignored.
    this.onMessage('*', (client: Client, type: string | number, data: unknown) => {
      // Unknown messages are silently dropped (SC-4 anti-cheat), but still count
      // toward the rate limit so an unknown-type flood triggers disconnect.
      this.allowMessage(client)
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

  onJoin(client: Client, options?: Record<string, unknown>): void {
    // Add player to plain state at world center
    const centerX = Math.floor(WORLD_W / 2)
    const centerY = Math.floor(WORLD_H / 2)

    // Validate join options via CharacterSelectSchema (T-05-11).
    // Parse each field independently so an invalid weaponId doesn't discard a valid classId.
    const classResult = CharacterSelectSchema.shape.classId.safeParse(options?.classId)
    const weaponResult = CharacterSelectSchema.shape.weaponId.safeParse(options?.weaponId)
    const classId = classResult.success ? classResult.data : 'human'
    const weaponId = weaponResult.success ? weaponResult.data : 'magic_wand'

    const catalogEntry = characterCatalog[classId]!

    const player: PlainPlayerState = {
      id: client.sessionId,
      x: centerX,
      y: centerY,
      hp: catalogEntry.baseMaxHp,
      maxHp: catalogEntry.baseMaxHp,
      level: 1,
      xp: 0,
      speed: catalogEntry.baseSpeed,
      weapons: [`${weaponId}:1`],
      passives: [],
      classId: classId,
      damageMultiplier: catalogEntry.damageMultiplier,
      fireRateMultiplier: catalogEntry.fireRateMultiplier,
      // Seed slot '0' weaponStats for the starting weapon — applyUpgrade only
      // seeds weaponStats for upgrade-acquired weapons, not the initial weapon.
      // Without this seed, applyCollisions writes into a missing key on tick 1.
      weaponStats: { '0': { totalDamage: 0, acquiredAtMs: 0 } },
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
    pSchema.classId = classId
    // uint16 scaled x100: 1.2 -> 120, 1.0 -> 100. Client divides by 100 on read.
    pSchema.damageMultiplier = Math.round(catalogEntry.damageMultiplier * 100)
    pSchema.fireRateMultiplier = Math.round(catalogEntry.fireRateMultiplier * 100)
    pSchema.weapons.push(`${weaponId}:1`)
    // Seed slot '0' weaponStats on the schema to match plainState.
    // Explicitly assign totalDamage/acquiredAtMs so the JSON serialization
    // includes these fields from the start (Colyseus omits fields that have
    // never been explicitly set, even when the value is the uint32 default 0 —
    // this ensures anti-cheat snapshot tests see a stable initial serialization).
    const seedWs = new WeaponStatsSchema()
    seedWs.totalDamage = 0
    seedWs.acquiredAtMs = 0
    pSchema.weaponStats.set('0', seedWs)
    this.state.players.set(client.sessionId, pSchema)
  }

  onLeave(client: Client): void {
    // Set 'survived' if the run has not already ended in defeat.
    // Check this.clients.length <= 1 BEFORE removing the leaving client —
    // Colyseus calls onLeave while the client is still in this.clients.
    // For a solo room (maxClients=1), this condition is always true on the
    // only player's leave, and future multiplayer rooms must re-evaluate.
    if (this.clients.length <= 1 && this.plainState.result !== 'defeated') {
      this.plainState.result = 'survived'
      this.state.result = 'survived'
    }

    this.plainState.players.delete(client.sessionId)
    this.state.players.delete(client.sessionId)
    this.prevLevels.delete(client.sessionId)
    this.pendingUpgradeOptions.delete(client.sessionId)
    this.messageRate.delete(client.sessionId)
    const timeout = this.upgradeTimeouts.get(client.sessionId)
    if (timeout) {
      clearTimeout(timeout)
      this.upgradeTimeouts.delete(client.sessionId)
    }
  }

  /**
   * Per-connection WS message rate gate (PITFALLS S4). Returns false when the
   * message should be dropped. Disconnects the client on egregious floods.
   * Wall-clock based — intentionally OUTSIDE the deterministic simulation.
   */
  private allowMessage(client: Client): boolean {
    const now = Date.now()
    const rec = this.messageRate.get(client.sessionId)
    if (rec === undefined || now - rec.windowStart >= SoloRoom.RATE_WINDOW_MS) {
      this.messageRate.set(client.sessionId, { count: 1, windowStart: now })
      return true
    }
    rec.count++
    if (rec.count > SoloRoom.RATE_HARD_LIMIT) {
      client.leave(4290) // custom close code: rate limit exceeded
      return false
    }
    return rec.count <= SoloRoom.RATE_SOFT_LIMIT
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
        const paused = this.pauseAndSendLevelUp(sessionId)
        if (paused) {
          return // Pause immediately, do not mirror further
        }
      }
      this.prevLevels.set(sessionId, player.level)
    }

    // Rare event check (GAME-11)
    const elapsed = this.plainState.elapsedMs
    const FIRST_CHECK_MS = 3 * 60 * 1000 // 180,000
    const REPEAT_MS = 2 * 60 * 1000 // 120,000

    if (elapsed >= FIRST_CHECK_MS && this.rareEventElapsedAtLastCheck === 0) {
      this.rareEventElapsedAtLastCheck = FIRST_CHECK_MS
      const paused = this.triggerRareEvent()
      if (paused) {
        return // Pause immediately
      }
    } else if (
      this.rareEventElapsedAtLastCheck > 0 &&
      elapsed - this.rareEventElapsedAtLastCheck >= REPEAT_MS
    ) {
      this.rareEventElapsedAtLastCheck += REPEAT_MS
      if (this.prng.next() < 0.25) {
        const paused = this.triggerRareEvent()
        if (paused) {
          return // Pause immediately
        }
      }
    }

    // Mirror plain state to Schema (in-place mutation)
    mirrorStateToSchema(this.plainState, this.state)

    // Pause simulation after defeat so no further simulateTick calls occur
    // (T-05-13). mirrorStateToSchema has already run above, so schema.result
    // and schema.players.*.hp are visible to clients before the pause takes effect.
    if (this.plainState.result === 'defeated') {
      this.simulationPaused = true
    }
  }

  private pauseAndSendLevelUp(sessionId: string): boolean {
    const options = selectUpgradeOptions(this.plainState, sessionId, this.prng)
    if (options.length === 0) {
      return false
    }

    this.simulationPaused = true
    this.pendingUpgradeOptions.set(sessionId, options)

    const client = this.clients.find((c) => c.sessionId === sessionId)
    if (client) {
      client.send('levelup', { options })
    }

    const timeout = setTimeout(() => {
      this.autoSelectUpgrade(sessionId)
    }, 15_000)
    this.upgradeTimeouts.set(sessionId, timeout)
    return true
  }

  private triggerRareEvent(): boolean {
    const sessionId = Array.from(this.plainState.players.keys())[0]
    if (sessionId) {
      const options = selectUpgradeOptions(this.plainState, sessionId, this.prng)
      if (options.length === 0) {
        return false
      }
      this.simulationPaused = true
      this.pendingUpgradeOptions.set(sessionId, options)
      this.broadcast('rare_event', { options })

      const timeout = setTimeout(() => {
        this.autoSelectUpgrade(sessionId)
      }, 15_000)
      this.upgradeTimeouts.set(sessionId, timeout)
      return true
    }
    return false
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

    const isDev = process.env['NODE_ENV'] !== 'production'
    const isValid =
      options.some((o) => o.id === upgradeId) || (isDev && upgradeId === 'test_upgrade')
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

    const client = this.clients.find((c) => c.sessionId === sessionId)
    if (client) {
      client.send('upgrade_applied', { upgradeId })
    }
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
  schema.kills = plain.kills ?? 0
  schema.result = plain.result ?? ''

  // --- Players: mutate existing, add new, delete removed ---
  for (const [id, p] of plain.players) {
    if (schema.players.has(id)) {
      // Mutate existing instance in-place (delta encoding preserves only changed fields)
      const ps = schema.players.get(id)!
      ps.x = p.x
      ps.y = p.y
      // Clamp hp to >= 0 before assigning to uint8: simulateTick can produce
      // negative hp on overkill (e.g. -3), which wraps to 253 in uint8 — visually
      // un-killing the player on the client.
      ps.hp = Math.max(0, p.hp)
      ps.maxHp = p.maxHp
      ps.level = p.level
      ps.xp = p.xp
      ps.classId = p.classId ?? 'human'
      ps.damageMultiplier = Math.round((p.damageMultiplier ?? 1) * 100)
      ps.fireRateMultiplier = Math.round((p.fireRateMultiplier ?? 1) * 100)

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

      // Sync weaponStats (D-21): get-or-create + mutate in-place (MUTATION RULE).
      // Never re-set an existing key with a new instance — delta encoder tracks instances.
      const plainWS = p.weaponStats ?? {}
      for (const [key, stats] of Object.entries(plainWS)) {
        let ws = ps.weaponStats.get(key)
        if (!ws) {
          ws = new WeaponStatsSchema()
          ps.weaponStats.set(key, ws)
        }
        ws.totalDamage = stats.totalDamage
        ws.acquiredAtMs = stats.acquiredAtMs
      }
      // Delete schema weaponStats entries not present in plain state
      for (const key of ps.weaponStats.keys()) {
        if (!(key in plainWS)) {
          ps.weaponStats.delete(key)
        }
      }
    } else {
      // Add new player
      const ps = new PlayerSchema()
      ps.id = id
      ps.x = p.x
      ps.y = p.y
      ps.hp = Math.max(0, p.hp)
      ps.maxHp = p.maxHp
      ps.level = p.level
      ps.xp = p.xp
      ps.classId = p.classId ?? 'human'
      ps.damageMultiplier = Math.round((p.damageMultiplier ?? 1) * 100)
      ps.fireRateMultiplier = Math.round((p.fireRateMultiplier ?? 1) * 100)
      for (const w of p.weapons) {
        ps.weapons.push(w)
      }
      for (const pass of p.passives) {
        ps.passives.push(pass)
      }
      // Seed weaponStats entries for new player
      const plainWS = p.weaponStats ?? {}
      for (const [key, stats] of Object.entries(plainWS)) {
        const ws = new WeaponStatsSchema()
        ws.totalDamage = stats.totalDamage
        ws.acquiredAtMs = stats.acquiredAtMs
        ps.weaponStats.set(key, ws)
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
      es.maxHp = e.maxHp
      es.archetype = e.archetype
      es.isElite = e.isElite ?? false
      es.eliteName = e.eliteName ?? ''
    } else {
      const es = new EnemySchema()
      es.id = id
      es.x = e.x
      es.y = e.y
      es.hp = e.hp
      es.maxHp = e.maxHp
      es.archetype = e.archetype
      es.isElite = e.isElite ?? false
      es.eliteName = e.eliteName ?? ''
      schema.enemies.set(id, es)
    }
  }
  for (const id of schema.enemies.keys()) {
    if (!plain.enemies.has(id)) {
      schema.enemies.delete(id)
    }
  }

  // --- Bosses: mutate existing, add new, delete removed ---
  for (const [id, b] of plain.bosses ?? []) {
    if (schema.bosses.has(id)) {
      const bs = schema.bosses.get(id)!
      bs.id = b.id
      bs.bossKey = b.bossKey
      bs.name = b.name
      bs.x = b.x
      bs.y = b.y
      bs.hp = b.hp
      bs.maxHp = b.maxHp
      bs.speed = b.speed
      bs.telegraphState = b.telegraphState ?? 'idle'
      bs.telegraphTick = b.telegraphTick ?? 0
    } else {
      const bs = new BossSchema()
      bs.id = b.id
      bs.bossKey = b.bossKey
      bs.name = b.name
      bs.x = b.x
      bs.y = b.y
      bs.hp = b.hp
      bs.maxHp = b.maxHp
      bs.speed = b.speed
      bs.telegraphState = b.telegraphState ?? 'idle'
      bs.telegraphTick = b.telegraphTick ?? 0
      schema.bosses.set(id, bs)
    }
  }
  for (const id of schema.bosses.keys()) {
    if (!(plain.bosses ?? new Map()).has(id)) {
      schema.bosses.delete(id)
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
