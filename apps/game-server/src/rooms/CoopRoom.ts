/**
 * CoopRoom — 2–4 player co-op room over BaseGameRoom (Phase 6).
 *
 * Part 1 (plan 06-08): the LOBBY state machine. The room is created in the
 * 'lobby' phase; players join, pick a class and toggle ready; the host (the
 * oldest connected client) starts the run, which lock()s the room. While the
 * room is not 'active' the simulation tick is blocked and nobody is seeded.
 *
 * - roomId IS the shareable 6-char code (06-RESEARCH.md Pattern 3), generated
 *   with a collision retry against the matchmaker cache.
 * - Private rooms are hidden from GET /rooms but joinable by code (joinById).
 * - Lobby names come from the game JWT via onAuth (server-attested, T-06-08) —
 *   never from join options.
 * - Host migration in the lobby: the oldest remaining client becomes host.
 *
 * Part 2 (plan 06-09) owns the in-run semantics: pick-without-pause, vote
 * pause, per-player rare events, mid-run leave and co-op defeat/survived.
 * Lobby-phase and in-run logic are kept in clearly separated methods.
 */
import { matchMaker } from '@colyseus/core'
import type { Client } from '@colyseus/core'
import {
  CharacterSelectSchema,
  CoopCreateOptionsSchema,
  ReadySchema,
  StartRunSchema,
} from '@game/shared'
import { BaseGameRoom } from './BaseGameRoom.js'
import { LobbyPlayerSchema } from '../schema/GameSchema.js'
import { generateRoomCode } from '../lib/roomCode.js'

/** 'starting' is the private transition while lock() is awaited (never on the wire). */
type CoopRoomPhase = 'lobby' | 'starting' | 'active'

/** Bounded so a pathological matchmaker cache can never spin onCreate forever. */
const MAX_CODE_ATTEMPTS = 20

export class CoopRoom extends BaseGameRoom {
  maxClients = 4

  private roomPhase: CoopRoomPhase = 'lobby'

  async onCreate(options?: unknown): Promise<void> {
    super.onCreate()

    // Room code = roomId. The listing is persisted only after onCreate resolves,
    // so replacing roomId here is safe (MatchMaker.handleCreateRoom).
    this.roomId = await this.generateUniqueRoomCode()

    // Parse isPrivate on its own (like seedPlayer's per-field parse): a create
    // whose token field is absent/invalid must never downgrade a requested
    // private room to a PUBLIC one that would leak via GET /rooms (T-06-13).
    // Identity is never read from create options — onAuth owns the token.
    const raw = (options ?? {}) as Record<string, unknown>
    const isPrivate = CoopCreateOptionsSchema.shape.isPrivate.safeParse(raw.isPrivate)
    if (isPrivate.success && isPrivate.data === true) {
      await this.setPrivate(true)
    }

    this.setRoomPhase('lobby')
    this.registerLobbyHandlers()
  }

  private async generateUniqueRoomCode(): Promise<string> {
    let code = generateRoomCode()
    for (let attempt = 1; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      // getRoomById yields the cache entry or undefined. The .d.ts says Promise,
      // but the LocalDriver's findOne returns synchronously (no .catch on the
      // result) — so await + try/catch, treating any error as "not found"
      // (06-RESEARCH.md assumption A1).
      let existing: unknown
      try {
        existing = await matchMaker.getRoomById(code)
      } catch {
        existing = undefined
      }
      if (!existing) return code
      code = generateRoomCode()
    }
    return code
  }

  private setRoomPhase(phase: CoopRoomPhase): void {
    this.roomPhase = phase
    // 'starting' is internal; clients keep seeing 'lobby' until the run is live.
    this.state.roomPhase = phase === 'active' ? 'active' : 'lobby'
  }

  // ---------------------------------------------------------------------------
  // Lobby phase
  // ---------------------------------------------------------------------------

  private registerLobbyHandlers(): void {
    // Shape: rate gate -> lobby-phase gate -> safeParse -> silent drop.
    this.onMessage('ready', (client: Client, data: unknown) => {
      if (!this.allowMessage(client)) return
      if (this.roomPhase !== 'lobby') return
      const result = ReadySchema.safeParse(data)
      if (!result.success) return
      const entry = this.state.lobby.get(client.sessionId)
      if (!entry) return
      entry.ready = result.data.ready
    })

    this.onMessage('select_class', (client: Client, data: unknown) => {
      if (!this.allowMessage(client)) return
      if (this.roomPhase !== 'lobby') return
      const result = CharacterSelectSchema.safeParse(data)
      if (!result.success) return
      const entry = this.state.lobby.get(client.sessionId)
      if (!entry) return
      entry.classId = result.data.classId
      entry.weaponId = result.data.weaponId
    })

    // StartRunSchema rejects undefined — clients must send room.send('start_run', {}).
    this.onMessage('start_run', (client: Client, data: unknown) => {
      if (!this.allowMessage(client)) return
      if (!StartRunSchema.safeParse(data).success) return
      void this.tryStartRun(client).catch((err: unknown) => {
        console.error('[CoopRoom] start_run failed', err)
      })
    })
  }

  /**
   * Host-only, 2+ players, everyone ready (ROOM-03/04). Anything else is a
   * silent drop. Host identity is server-derived (oldest client — T-06-11).
   */
  private async tryStartRun(client: Client): Promise<void> {
    if (this.roomPhase !== 'lobby') return
    if (this.clients[0]?.sessionId !== client.sessionId) return
    if (this.clients.length < 2) return
    const allReady = this.clients.every((c) => this.state.lobby.get(c.sessionId)?.ready === true)
    if (!allReady) return

    // Leave 'lobby' synchronously BEFORE awaiting lock(): a join completing
    // during the await hits the onJoin guard, and a duplicate start_run
    // cannot seed twice. The tick stays blocked until 'active'.
    this.setRoomPhase('starting')
    // No-arg lock() = explicit lock: a mid-run leave from a full room must not
    // auto-unlock it (Pitfall 3, T-06-12).
    await this.lock()

    // Lobby-time inputs never reach the first simulated tick.
    this.pendingInputs.clear()

    for (const c of this.clients) {
      const entry = this.state.lobby.get(c.sessionId)
      this.seedPlayer(c, { classId: entry?.classId, weaponId: entry?.weaponId })
    }

    // Difficulty snapshot (06-07 contract, OQ2): set exactly once here and
    // never recomputed on disconnect.
    this.plainState.mode = 'coop'
    this.plainState.playerCount = this.clients.length

    // The lobby roster is intentionally kept (in-run HUD reads displayName).
    this.setRoomPhase('active')
  }

  async onJoin(client: Client): Promise<void> {
    // Late-join guard (Pitfall 3, T-06-12): lock() on start is the primary
    // mechanism; this rejects any seat reservation issued before the lock.
    if (this.roomPhase !== 'lobby') {
      throw new Error('Room already started')
    }

    const entry = new LobbyPlayerSchema()
    entry.displayName = this.authDisplayName(client)
    // Colyseus pushes the client into this.clients before onJoin, so the very
    // first client is clients[0] — the host.
    entry.isHost = this.clients[0]?.sessionId === client.sessionId
    this.state.lobby.set(client.sessionId, entry)

    if (entry.isHost) {
      await this.setMetadata({ hostName: entry.displayName })
    }
  }

  /** Server-attested name from onAuth (game JWT). Never from join options. */
  private authDisplayName(client: Client): string {
    const auth = client.auth as { displayName?: unknown } | undefined
    const name = auth?.displayName
    return typeof name === 'string' && name.length > 0 ? name : 'Player'
  }

  async onLeave(client: Client): Promise<void> {
    if (this.roomPhase === 'lobby') {
      await this.handleLobbyLeave(client)
    }
    // Mid-run leave semantics belong to plan 06-09; the lobby roster is kept
    // intact in-run (HUD reads displayName from it).
    super.onLeave(client)
  }

  private async handleLobbyLeave(client: Client): Promise<void> {
    const entry = this.state.lobby.get(client.sessionId)
    // No entry: a join rejected by the onJoin guard also lands here.
    if (!entry) return
    this.state.lobby.delete(client.sessionId)
    if (!entry.isHost) return

    // Colyseus removes the leaver from this.clients before onLeave runs; the
    // filter keeps this correct either way. Oldest remaining = new host.
    const next = this.clients.find((c) => c.sessionId !== client.sessionId)
    if (!next) return
    const nextEntry = this.state.lobby.get(next.sessionId)
    if (!nextEntry) return
    nextEntry.isHost = true
    await this.setMetadata({ hostName: nextEntry.displayName })
    this.broadcast('host_changed', { hostSessionId: next.sessionId })
  }

  // ---------------------------------------------------------------------------
  // BaseGameRoom hook seams. Final in-run semantics: plan 06-09.
  // ---------------------------------------------------------------------------

  protected onUpgradePending(sessionId: string): void {
    void sessionId // co-op never pauses the world on a pick (06-09)
  }

  protected onUpgradeResolved(sessionId: string): void {
    void sessionId
  }

  protected isTickBlocked(): boolean {
    // Lobby (and the lock() transition) never simulates. 06-09 adds vote-pause.
    return this.roomPhase !== 'active'
  }

  protected triggerRareEvent(): boolean {
    // Abstract contract placeholder: no rare event, not paused. Per-player
    // rare-event options land in plan 06-09.
    return false
  }
}
