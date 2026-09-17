/**
 * BaseGameRoom — abstract, mode-agnostic Colyseus room over simulateTick.
 *
 * Extracted verbatim from SoloRoom (06-05) so SoloRoom (maxClients=1) and
 * CoopRoom (2–4 players) share one implementation of everything that does not
 * depend on the player count:
 * - Validate game JWT in static onAuth (T-3-03)
 * - Per-connection WS message rate limiting (PITFALLS S4)
 * - Accept only PlayerInputSchema-valid input messages (T-3-04) with the
 *   per-session anti-replay watermark (T-06-01)
 * - upgrade_selected / replace_slot / wildcard silent-drop handlers
 * - Call simulateTick every 50ms using TICK_SEC constant (never _dt)
 * - Level-up flow, 15s auto-select timeouts, rare-event scheduling
 * - Mirror PlainGameState into Colyseus Schema in-place for delta encoding
 *
 * Mode-specific semantics are template-method hooks (06-RESEARCH.md Pattern 1):
 * - onUpgradePending / onUpgradeResolved — solo toggles the global pause,
 *   co-op keeps the sim running for everyone else
 * - isTickBlocked — solo: simulationPaused; co-op: lobby / vote-pause state
 * - filterInputs — identity by default; co-op drops inputs of players mid-pick
 * - triggerRareEvent — solo: single-player body; co-op: per-player options
 * - onDefeat — solo pauses the sim once the run is lost; co-op decides later
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
import { GameStateSchema, PlayerSchema, WeaponStatsSchema } from '../schema/GameSchema.js'
import { verifyGameToken } from '../lib/gameToken.js'
import { env, isDevEnv } from '../lib/env.js'
import { mirrorStateToSchema } from './mirrorStateToSchema.js'

export abstract class BaseGameRoom extends Room<{ state: GameStateSchema }> {
  protected plainState!: PlainGameState
  protected prng!: Prng
  protected pendingInputs: Map<string, PlayerInput> = new Map()
  // Anti-replay watermark (T-06-01): highest accepted input seq per SESSION.
  // Keyed by client.sessionId (never userId — Pitfall 7: a rejoining player
  // gets a fresh session and must restart at seq 0). Cleaned in onLeave.
  protected lastSeq = new Map<string, number>()
  protected prevLevels = new Map<string, number>()
  protected pendingUpgradeOptions = new Map<string, UpgradeOption[]>()
  protected upgradeTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
  protected rareEventElapsedAtLastCheck = 0

  // Per-connection WS message rate limiting (PITFALLS S4) — 1s sliding window.
  // Legitimate clients send input at 20Hz (~20 msg/s); SOFT silently drops
  // floods, HARD disconnects egregious abuse. Wall-clock based and intentionally
  // OUTSIDE the deterministic simulation (does not affect simulateTick output).
  private static readonly RATE_WINDOW_MS = 1000
  private static readonly RATE_SOFT_LIMIT = 60
  private static readonly RATE_HARD_LIMIT = 200
  protected messageRate = new Map<string, { count: number; windowStart: number }>()

  // ---------------------------------------------------------------------------
  // Hook seams (06-RESEARCH.md Pattern 1). Subclasses decide the mode-specific
  // semantics; the base never touches a pause flag directly.
  // ---------------------------------------------------------------------------

  /** A level-up / rare-event pick is now pending for this session. */
  protected abstract onUpgradePending(sessionId: string): void

  /** The pending pick for this session was applied (or slot-replaced). */
  protected abstract onUpgradeResolved(sessionId: string): void

  /** When true, tick() returns before simulateTick runs. */
  protected abstract isTickBlocked(): boolean

  /** Rare event (GAME-11). Must keep the return contract: true = paused now. */
  protected abstract triggerRareEvent(): boolean

  /** Inputs handed to simulateTick this tick. Identity by default. */
  protected filterInputs(inputs: Map<string, PlayerInput>): Map<string, PlayerInput> {
    return inputs
  }

  /** The run ended in defeat this tick (after the schema mirror). No-op by default. */
  protected onDefeat(): void {}

  onCreate(): void {
    this.setState(new GameStateSchema())

    // makeInitialState seeds one player 'p1' for @game/shared movement tests.
    // The room must clear that phantom player so the Schema only tracks real clients.
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
      // Anti-replay monotonic check (T-06-01): drop any frame whose seq is not
      // strictly greater than the last accepted one for this session. Silent
      // drop matches the anti-cheat posture of the wildcard handler.
      const last = this.lastSeq.get(client.sessionId) ?? -1
      if (result.data.seq <= last) return
      this.lastSeq.set(client.sessionId, result.data.seq)
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
      // Allowlist gating via validated env (T-06-02, Pitfall 8) — never bare process.env.
      const isDev = isDevEnv(env.NODE_ENV)
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
      this.onUpgradeResolved(sessionId)
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

  /**
   * Seed a freshly joined client into plainState + schema at world center.
   * SoloRoom calls this from onJoin; CoopRoom calls it at start_run time.
   */
  protected seedPlayer(client: Client, options?: Record<string, unknown>): void {
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
    this.plainState.players.delete(client.sessionId)
    this.state.players.delete(client.sessionId)
    this.prevLevels.delete(client.sessionId)
    this.pendingUpgradeOptions.delete(client.sessionId)
    this.messageRate.delete(client.sessionId)
    this.lastSeq.delete(client.sessionId) // anti-replay watermark is per-session (Pitfall 7)
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
  protected allowMessage(client: Client): boolean {
    const now = Date.now()
    const rec = this.messageRate.get(client.sessionId)
    if (rec === undefined || now - rec.windowStart >= BaseGameRoom.RATE_WINDOW_MS) {
      this.messageRate.set(client.sessionId, { count: 1, windowStart: now })
      return true
    }
    rec.count++
    if (rec.count > BaseGameRoom.RATE_HARD_LIMIT) {
      client.leave(4290) // custom close code: rate limit exceeded
      return false
    }
    return rec.count <= BaseGameRoom.RATE_SOFT_LIMIT
  }

  /**
   * Game tick — called every 50ms by setSimulationInterval.
   * CRITICAL: _dt is intentionally ignored. Use TICK_SEC constant only (SC-2).
   */
  private tick(): void {
    if (this.isTickBlocked()) return

    // Run pure simulation
    const newState = simulateTick(this.plainState, this.filterInputs(this.pendingInputs), this.prng)
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
      this.onDefeat()
    }
  }

  protected pauseAndSendLevelUp(sessionId: string): boolean {
    const options = selectUpgradeOptions(this.plainState, sessionId, this.prng)
    if (options.length === 0) {
      return false
    }

    this.onUpgradePending(sessionId)
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

  protected autoSelectUpgrade(sessionId: string): void {
    const options = this.pendingUpgradeOptions.get(sessionId)
    if (!options || options.length === 0) return
    const choice = options[0]
    if (choice) {
      this.handleUpgradeSelected(sessionId, choice.id)
    }
  }

  protected handleUpgradeSelected(sessionId: string, upgradeId: string): void {
    const timeout = this.upgradeTimeouts.get(sessionId)
    if (timeout) {
      clearTimeout(timeout)
      this.upgradeTimeouts.delete(sessionId)
    }

    const options = this.pendingUpgradeOptions.get(sessionId)
    if (!options) return

    // Allowlist gating via validated env (T-06-02, Pitfall 8) — never bare process.env.
    const isDev = isDevEnv(env.NODE_ENV)
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
    this.onUpgradeResolved(sessionId)
    mirrorStateToSchema(this.plainState, this.state)

    const client = this.clients.find((c) => c.sessionId === sessionId)
    if (client) {
      client.send('upgrade_applied', { upgradeId })
    }
  }
}
