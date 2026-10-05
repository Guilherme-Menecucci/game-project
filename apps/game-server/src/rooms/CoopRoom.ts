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
 *
 * Pick-without-pause (ROOM-06, locked decision "Pick sem pausa"): the world
 * NEVER pauses for a level-up / rare-event pick. The picking player's input is
 * dropped in filterInputs (no moveVector -> the sim's movement step skips them)
 * while auto-fire, contact damage and every teammate keep running. Because the
 * world keeps ticking, a player mid-pick can level up again (gem magnet) or be
 * offered a rare event — those offers are QUEUED per session and delivered one
 * clock tick after the current pick resolves (never overwriting the pending
 * options/timeout, and never before the client has seen 'upgrade_applied').
 *
 * Vote-pause (ROOM-11, 06-RESEARCH.md Pattern 8): the ONE legitimate whole-world
 * pause in co-op. Simple majority of alive voters (connected, not eliminated —
 * downed players still vote), one vote at a time, 15s window. isTickBlocked()
 * ORs votePaused in, which freezes elapsedMs/spawns exactly like solo's pause.
 *
 * End of run: the room never sets 'survived' (OQ4 — a leaver's client shows its
 * own local survived summary). The only room-level result is the sim's
 * full-squad 'defeated' (plan 06-03), after which roomPhase becomes 'ended' and
 * ticking stops; clients read state.result exactly as in solo.
 */
import { matchMaker } from '@colyseus/core'
import type { Client } from '@colyseus/core'
import {
  CharacterSelectSchema,
  CoopCreateOptionsSchema,
  ReadySchema,
  StartRunSchema,
  VotePauseSchema,
  VoteResumeSchema,
  selectUpgradeOptions,
} from '@game/shared'
import type { PlayerInput } from '@game/shared'
import { BaseGameRoom } from './BaseGameRoom.js'
import { LobbyPlayerSchema } from '../schema/GameSchema.js'
import { generateRoomCode } from '../lib/roomCode.js'

/**
 * 'starting' is the private transition while lock() is awaited (never on the
 * wire — clients keep seeing 'lobby'). 'ended' = full-squad defeat (06-09).
 */
type CoopRoomPhase = 'lobby' | 'starting' | 'active' | 'ended'

/** Bounded so a pathological matchmaker cache can never spin onCreate forever. */
const MAX_CODE_ATTEMPTS = 20

/** Pick auto-select window — same 15s as BaseGameRoom.pauseAndSendLevelUp (D-14). */
const PICK_TIMEOUT_MS = 15_000

/** A pick offer that arrived while the session already had one pending. */
type QueuedOffer = 'levelup' | 'rare_event'

type VoteKind = 'pause' | 'resume'

/** 'vote_pause_state' lifecycle: open -> passed | expired | cancelled. */
type VoteStatus = 'open' | 'passed' | 'expired' | 'cancelled'

interface PauseVote {
  kind: VoteKind
  votes: Set<string>
  timer: ReturnType<typeof setTimeout>
}

export class CoopRoom extends BaseGameRoom {
  maxClients = 4

  private roomPhase: CoopRoomPhase = 'lobby'

  /** Per-session FIFO of offers deferred behind a pending pick (in-run only). */
  private queuedOffers = new Map<string, QueuedOffer[]>()

  /** Vote window (ROOM-11 locked: 15s). Instance field so tests can shorten it. */
  VOTE_WINDOW_MS = 15_000
  /** Whole-world pause set only by a passed vote (never by picks). */
  private votePaused = false
  /** The single active vote, if any (one at a time — T-06-15). */
  private pauseVote: PauseVote | null = null

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
    this.registerVoteHandlers()
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
    // Wire values: 'lobby' | 'active' | 'ended'.
    this.state.roomPhase = phase === 'starting' ? 'lobby' : phase
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
    } else if (this.roomPhase === 'active' || this.roomPhase === 'ended') {
      this.handleRunLeave(client)
    }
    this.queuedOffers.delete(client.sessionId)
    // Base cleanup: plainState + schema player, pending pick + timeout, rate and
    // anti-replay maps. No re-join in the same run (v1).
    super.onLeave(client)
    // The leaver no longer counts: drop their vote and re-tally (needed may
    // shrink, so the vote can pass — or empty out and cancel — right here).
    if (this.pauseVote) this.evaluateVote()
    this.releaseOrphanedPause()
  }

  /**
   * Anti-griefing (T-06-15): a passed pause with NO alive voter left (everyone
   * remaining is eliminated) could never be resumed — and while paused no tick
   * runs, so the sim's full-squad defeat rule could never fire either. Release
   * the pause; the next tick then detects defeat and ends the room.
   */
  private releaseOrphanedPause(): void {
    if (!this.votePaused || this.roomPhase !== 'active') return
    if (this.aliveVoterIds().length > 0) return
    if (this.pauseVote) this.closeVote('cancelled', this.votesNeeded())
    this.votePaused = false
    this.broadcast('vote_pause_state', {
      kind: 'resume',
      votes: 0,
      needed: this.votesNeeded(),
      status: 'cancelled',
      paused: false,
    })
  }

  /**
   * Mid-run leave (OQ4). The room never sets a 'survived' result here — that is
   * solo-only semantics; the leaver's client shows its own local summary and the
   * run continues for everyone else. The lobby entry goes too, so state.lobby
   * mirrors the live squad (no ghost teammate in the HUD roster).
   * plainState.mode/playerCount are never touched (frozen at start, 06-07/06-08).
   */
  private handleRunLeave(client: Client): void {
    this.state.lobby.delete(client.sessionId)
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
  // In-run: pick-without-pause (ROOM-06) + per-player rare events (Pitfall 4)
  // ---------------------------------------------------------------------------

  /**
   * Drop the moveVector of every player with a pending pick (06-RESEARCH.md
   * Pattern 5). No input -> simulateTick's movement step skips them; autoFire
   * does not read input, so the picking player keeps firing. No sim pause state.
   */
  protected override filterInputs(inputs: Map<string, PlayerInput>): Map<string, PlayerInput> {
    for (const sessionId of this.pendingUpgradeOptions.keys()) {
      inputs.delete(sessionId)
    }
    return inputs
  }

  /**
   * Level-up offer. Return contract is "true = the world is paused now" — co-op
   * never pauses, so this always returns false and the base tick() continues to
   * the remaining players' level-up checks, rare events, the schema mirror and
   * the defeat check on the same tick. A level-up arriving while a pick is
   * already pending is queued (never overwrites the pending options/timeout).
   */
  protected override pauseAndSendLevelUp(sessionId: string): boolean {
    if (this.pendingUpgradeOptions.has(sessionId)) {
      this.enqueueOffer(sessionId, 'levelup')
      return false
    }
    super.pauseAndSendLevelUp(sessionId)
    return false
  }

  /** Locked decision (ROOM-06): the world never pauses on a pick. */
  protected onUpgradePending(sessionId: string): void {
    void sessionId
  }

  /**
   * The pick resolved. The world was never paused, so nothing to resume — but a
   * queued offer is delivered one clock tick later: 'upgrade_applied' is sent
   * AFTER this hook returns and the client clears its picker on it, so an offer
   * sent synchronously here would be wiped on the client.
   */
  protected onUpgradeResolved(sessionId: string): void {
    if ((this.queuedOffers.get(sessionId)?.length ?? 0) === 0) return
    this.clock.setTimeout(() => this.drainQueuedOffer(sessionId), 0)
  }

  protected isTickBlocked(): boolean {
    // Lobby, the lock() transition and 'ended' never simulate; a passed
    // vote-pause freezes the whole world (ROOM-11). Picks never block (ROOM-06).
    return this.roomPhase !== 'active' || this.votePaused
  }

  /**
   * Full-squad defeat (sim rule, plan 06-03: every player downed or eliminated).
   * Runs after the schema mirror, so state.result='defeated' is already on the
   * wire. Flip to 'ended' (blocks every further tick) and drop in-run timers so
   * nothing mutates the finished run.
   */
  protected override onDefeat(): void {
    if (this.roomPhase === 'ended') return
    this.setRoomPhase('ended')
    if (this.pauseVote) this.closeVote('cancelled', this.votesNeeded())
    for (const timeout of this.upgradeTimeouts.values()) clearTimeout(timeout)
    this.upgradeTimeouts.clear()
    this.pendingUpgradeOptions.clear()
    this.queuedOffers.clear()
  }

  onDispose(): void {
    if (this.pauseVote) clearTimeout(this.pauseVote.timer)
    this.pauseVote = null
  }

  // ---------------------------------------------------------------------------
  // In-run: vote-pause (ROOM-11, 06-RESEARCH.md Pattern 8)
  // ---------------------------------------------------------------------------

  private registerVoteHandlers(): void {
    // Shape: rate gate -> safeParse ({} only) -> silent drop. Phase/eligibility
    // gates live in castVote.
    this.onMessage('vote_pause', (client: Client, data: unknown) => {
      if (!this.allowMessage(client)) return
      if (!VotePauseSchema.safeParse(data).success) return
      this.castVote(client.sessionId, 'pause')
    })

    this.onMessage('vote_resume', (client: Client, data: unknown) => {
      if (!this.allowMessage(client)) return
      if (!VoteResumeSchema.safeParse(data).success) return
      this.castVote(client.sessionId, 'resume')
    })
  }

  /**
   * Initiate or join a vote. Pause votes only while running, resume votes only
   * while paused — so a vote of the other kind can never run concurrently. A
   * repeat vote from the same session is a no-op (Set semantics, T-06-15).
   */
  private castVote(sessionId: string, kind: VoteKind): void {
    if (this.roomPhase !== 'active') return
    if (!this.aliveVoterIds().includes(sessionId)) return
    if (kind === 'pause' ? this.votePaused : !this.votePaused) return
    if (this.pauseVote && this.pauseVote.kind !== kind) return

    if (!this.pauseVote) {
      // Wall-clock window (outside the sim — same class as the upgrade timeouts).
      const timer = setTimeout(() => this.expireVote(), this.VOTE_WINDOW_MS)
      this.pauseVote = { kind, votes: new Set<string>(), timer }
    }
    if (this.pauseVote.votes.has(sessionId)) return
    this.pauseVote.votes.add(sessionId)
    this.evaluateVote()
  }

  /** Connected clients whose player exists and is not eliminated (downed still vote). */
  private aliveVoterIds(): string[] {
    const ids: string[] = []
    for (const c of this.clients) {
      const player = this.plainState.players.get(c.sessionId)
      if (player && !player.eliminated) ids.push(c.sessionId)
    }
    return ids
  }

  /** Simple majority of alive voters: floor(alive / 2) + 1. */
  private votesNeeded(): number {
    return Math.floor(this.aliveVoterIds().length / 2) + 1
  }

  /**
   * Re-tally the active vote: drop votes of sessions that are no longer alive
   * voters (left / eliminated), then pass, cancel (no votes left) or broadcast
   * the open state.
   */
  private evaluateVote(): void {
    const vote = this.pauseVote
    if (!vote) return
    const alive = new Set(this.aliveVoterIds())
    for (const id of vote.votes) {
      if (!alive.has(id)) vote.votes.delete(id)
    }
    const needed = Math.floor(alive.size / 2) + 1
    if (vote.votes.size === 0) {
      this.closeVote('cancelled', needed)
      return
    }
    if (vote.votes.size >= needed) {
      this.votePaused = vote.kind === 'pause'
      this.closeVote('passed', needed)
      return
    }
    this.broadcastVoteState(vote, 'open', needed)
  }

  private expireVote(): void {
    if (!this.pauseVote) return
    this.closeVote('expired', this.votesNeeded())
  }

  private closeVote(status: Exclude<VoteStatus, 'open'>, needed: number): void {
    const vote = this.pauseVote
    if (!vote) return
    clearTimeout(vote.timer)
    this.pauseVote = null
    this.broadcastVoteState(vote, status, needed)
  }

  /** 'vote_pause_state' { kind, votes, needed, status, paused } to every client. */
  private broadcastVoteState(vote: PauseVote, status: VoteStatus, needed: number): void {
    this.broadcast('vote_pause_state', {
      kind: vote.kind,
      votes: vote.votes.size,
      needed,
      status,
      paused: this.votePaused,
    })
  }

  /**
   * Rare event (GAME-11) in co-op: every player that is neither downed nor
   * eliminated gets their OWN selectUpgradeOptions draw, registered in the
   * per-session maps and sent to that client only (Pitfall 4). Iteration is in
   * plainState.players insertion order (deterministic prng draw order). A player
   * already mid-pick gets the rare event queued. Returns false: the world never
   * pauses (base return contract "true = paused now").
   */
  protected triggerRareEvent(): boolean {
    for (const [sessionId, player] of this.plainState.players) {
      if (player.downed || player.eliminated) continue
      if (this.pendingUpgradeOptions.has(sessionId)) {
        this.enqueueOffer(sessionId, 'rare_event')
        continue
      }
      this.offerRareEvent(sessionId)
    }
    return false
  }

  /** Generate, register and send one player's rare-event options. */
  private offerRareEvent(sessionId: string): boolean {
    const options = selectUpgradeOptions(this.plainState, sessionId, this.prng)
    if (options.length === 0) return false
    this.pendingUpgradeOptions.set(sessionId, options)
    const timeout = setTimeout(() => {
      this.autoSelectUpgrade(sessionId)
    }, PICK_TIMEOUT_MS)
    this.upgradeTimeouts.set(sessionId, timeout)
    this.clients.find((c) => c.sessionId === sessionId)?.send('rare_event', { options })
    return true
  }

  private enqueueOffer(sessionId: string, offer: QueuedOffer): void {
    const queue = this.queuedOffers.get(sessionId)
    if (queue) {
      queue.push(offer)
    } else {
      this.queuedOffers.set(sessionId, [offer])
    }
  }

  /** Deliver the next queued offer that still applies (one pick at a time). */
  private drainQueuedOffer(sessionId: string): void {
    if (this.roomPhase !== 'active') return
    if (this.pendingUpgradeOptions.has(sessionId)) return // re-drained on resolve
    const queue = this.queuedOffers.get(sessionId)
    while (queue && queue.length > 0) {
      const offer = queue.shift()!
      const player = this.plainState.players.get(sessionId)
      if (!player) break
      if (offer === 'levelup') {
        super.pauseAndSendLevelUp(sessionId)
      } else if (!player.downed && !player.eliminated) {
        this.offerRareEvent(sessionId)
      }
      if (this.pendingUpgradeOptions.has(sessionId)) break // offered — wait for the pick
    }
    if (!queue || queue.length === 0) this.queuedOffers.delete(sessionId)
  }
}
