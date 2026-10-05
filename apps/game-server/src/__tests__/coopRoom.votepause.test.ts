/**
 * CoopRoom vote-pause + co-op leave/end semantics (ROOM-11, plan 06-09).
 *
 * Vote-pause (06-RESEARCH.md Pattern 8 — a legitimate whole-world pause):
 * - 'vote_pause' / 'vote_resume' payloads are `{}` (Zod-gated, silent drop)
 * - needed = floor(alive / 2) + 1; alive = connected clients whose player is
 *   not eliminated (downed players still vote; eliminated votes are dropped)
 * - every change broadcasts 'vote_pause_state'
 *   { kind, votes, needed, status: 'open'|'passed'|'expired'|'cancelled', paused }
 * - majority flips the pause (tick freeze proven via elapsedMs); resume mirrors it
 * - an unresolved vote expires after VOTE_WINDOW_MS (15s; shortened in tests)
 * - Set semantics per session; one active vote at a time (T-06-15)
 *
 * Leave/end:
 * - mid-run leave removes the player (plainState + schema + lobby entry), never
 *   sets a room-level 'survived', and the run continues for the rest
 * - full-squad defeat (sim rule, plan 06-03) -> roomPhase 'ended', ticking stops
 *
 * NOTE: client.waitForNextPatch() is dead against @colyseus/sdk 0.17.42 —
 * waits poll with a deadline. The real 50ms simulation interval keeps ticking.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { ColyseusTestServer, boot } from '@colyseus/testing'
import jwt from 'jsonwebtoken'
import { appConfig } from '../app.config.js'

const TEST_JWT_SECRET = process.env['JWT_SECRET']!

function signTestGameToken(userId: string, displayName: string): string {
  return jwt.sign({ userId, type: 'game', displayName }, TEST_JWT_SECRET, { expiresIn: '5m' })
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const settle = (ms = 150): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const NAMES = ['Alice', 'Bob', 'Carol', 'Dave']

describe('CoopRoom vote-pause + leave/end semantics (ROOM-11)', () => {
  let server: ColyseusTestServer

  beforeAll(async () => {
    server = await boot(appConfig)
  })

  afterAll(async () => {
    await server.shutdown()
  })

  beforeEach(async () => {
    await server.cleanup()
  })

  async function join(room: any, userId: string, displayName: string): Promise<any> {
    server.sdk.auth.token = signTestGameToken(userId, displayName)
    return server.connectTo(room)
  }

  /** Lobby with n clients (sequential connects). Each client records vote_pause_state. */
  async function lobby(n: number): Promise<{ room: any; clients: any[]; msgs: any[][] }> {
    const room = (await server.createRoom('coop_room', {})) as any
    const clients: any[] = []
    const msgs: any[][] = []
    for (let i = 0; i < n; i++) {
      const name = NAMES[i]!
      const c = await join(room, `user-${name.toLowerCase()}`, name)
      const inbox: any[] = []
      c.onMessage('vote_pause_state', (m: any) => inbox.push(m))
      clients.push(c)
      msgs.push(inbox)
    }
    await waitUntil(() => room.state.lobby.size === n)
    return { room, clients, msgs }
  }

  /** Lobby flow (plan 06-08): everyone ready, host starts the run. */
  async function startedRun(n = 3): Promise<{ room: any; clients: any[]; msgs: any[][] }> {
    const ctx = await lobby(n)
    const { room, clients } = ctx
    for (const c of clients) c.send('ready', { ready: true })
    await waitUntil(() => clients.every((c) => room.state.lobby.get(c.sessionId)?.ready === true))
    clients[0].send('start_run', {})
    await waitUntil(() => room.state.roomPhase === 'active' && room.plainState.players.size === n)
    expect(room.state.roomPhase).toBe('active')
    return ctx
  }

  const last = (inbox: any[]): any => inbox[inbox.length - 1]

  async function leaveAll(clients: any[]): Promise<void> {
    for (const c of clients) {
      try {
        await c.leave()
      } catch {
        // already gone
      }
    }
  }

  it('a pause vote opens at 1/needed and is broadcast to every client', async () => {
    const { room, clients, msgs } = await startedRun(3)
    const [a] = clients

    a.send('vote_pause', {})
    await waitUntil(() => msgs.every((inbox) => inbox.length >= 1))

    for (const inbox of msgs) {
      expect(inbox.length).toBe(1)
      expect(inbox[0]).toMatchObject({
        kind: 'pause',
        votes: 1,
        needed: 2, // floor(3 / 2) + 1
        status: 'open',
        paused: false,
      })
    }
    // Not paused yet: the world still ticks.
    const e0 = room.plainState.elapsedMs
    await settle(150)
    expect(room.plainState.elapsedMs).toBeGreaterThan(e0)

    await leaveAll(clients)
  })

  it('majority pauses the tick loop; a resume majority unpauses it', async () => {
    const { room, clients, msgs } = await startedRun(3)
    const [a, b] = clients

    a.send('vote_pause', {})
    await waitUntil(() => last(msgs[2]!)?.votes === 1)
    b.send('vote_pause', {})
    await waitUntil(() => last(msgs[2]!)?.status === 'passed')

    for (const inbox of msgs) {
      expect(last(inbox)).toMatchObject({
        kind: 'pause',
        votes: 2,
        needed: 2,
        status: 'passed',
        paused: true,
      })
    }

    // Tick freeze: elapsedMs stops advancing across ticks.
    await settle(100)
    const frozen = room.plainState.elapsedMs
    const frozenTick = room.state.tick
    await settle(300)
    expect(room.plainState.elapsedMs).toBe(frozen)
    expect(room.state.tick).toBe(frozenTick)

    // A pause vote while paused is ignored (only resume votes are accepted).
    const before = msgs[0]!.length
    a.send('vote_pause', {})
    await settle(150)
    expect(msgs[0]!.length).toBe(before)

    // Resume flow mirrors the pause flow.
    b.send('vote_resume', {})
    await waitUntil(() => last(msgs[0]!)?.kind === 'resume')
    expect(last(msgs[0]!)).toMatchObject({ kind: 'resume', votes: 1, needed: 2, status: 'open' })
    expect(room.plainState.elapsedMs).toBe(frozen) // still paused mid-vote

    clients[2].send('vote_resume', {})
    await waitUntil(() => last(msgs[0]!)?.status === 'passed' && last(msgs[0]!)?.kind === 'resume')
    expect(last(msgs[0]!)).toMatchObject({
      kind: 'resume',
      votes: 2,
      needed: 2,
      status: 'passed',
      paused: false,
    })
    await waitUntil(() => room.plainState.elapsedMs > frozen)
    expect(room.plainState.elapsedMs).toBeGreaterThan(frozen)

    await leaveAll(clients)
  })

  it('an unresolved vote expires after the window; a fresh vote restarts at 1', async () => {
    const { room, clients, msgs } = await startedRun(3)
    const [a, b] = clients
    room.VOTE_WINDOW_MS = 200

    a.send('vote_pause', {})
    await waitUntil(() => last(msgs[1]!)?.status === 'open')
    await waitUntil(() => last(msgs[1]!)?.status === 'expired', 2000)
    expect(last(msgs[1]!)).toMatchObject({ kind: 'pause', status: 'expired', paused: false })
    expect(room.pauseVote).toBeNull()

    // World never paused.
    const e0 = room.plainState.elapsedMs
    await settle(150)
    expect(room.plainState.elapsedMs).toBeGreaterThan(e0)

    // A fresh vote (different initiator) restarts at votes: 1.
    room.VOTE_WINDOW_MS = 15_000
    b.send('vote_pause', {})
    await waitUntil(() => last(msgs[0]!)?.status === 'open')
    expect(last(msgs[0]!)).toMatchObject({ kind: 'pause', votes: 1, status: 'open' })

    await leaveAll(clients)
  })

  it('duplicate votes do not double-count; no concurrent vote of the other kind', async () => {
    const { room, clients, msgs } = await startedRun(3)
    const [a] = clients

    a.send('vote_pause', {})
    await waitUntil(() => msgs[0]!.length === 1)
    a.send('vote_pause', {})
    a.send('vote_pause', {})
    await settle(200)
    expect(room.pauseVote.votes.size).toBe(1)
    expect(last(msgs[0]!)).toMatchObject({ kind: 'pause', votes: 1, status: 'open' })
    expect(room.votePaused).toBe(false)

    // A resume vote while not paused (and while a pause vote is active) is dropped.
    clients[1].send('vote_resume', {})
    await settle(150)
    expect(room.pauseVote.kind).toBe('pause')
    expect(msgs[0]!.every((m: any) => m.kind === 'pause')).toBe(true)

    await leaveAll(clients)
  })

  it('invalid payloads are silently dropped (Zod gate) and votes are in-run only', async () => {
    // Lobby phase: votes ignored.
    const lobbyCtx = await lobby(2)
    lobbyCtx.clients[0].send('vote_pause', {})
    await settle(150)
    expect(lobbyCtx.room.pauseVote).toBeNull()
    expect(lobbyCtx.msgs[1]!.length).toBe(0)
    await leaveAll(lobbyCtx.clients)

    const { room, clients, msgs } = await startedRun(3)
    const [a] = clients
    a.send('vote_pause', 'pause')
    a.send('vote_pause', 42)
    a.send('vote_pause')
    a.send('vote_resume', [1, 2])
    await settle(200)
    expect(room.pauseVote).toBeNull()
    expect(room.votePaused).toBe(false)
    for (const inbox of msgs) expect(inbox.length).toBe(0)

    // The connection survived the junk (silent drop, not a disconnect).
    a.send('vote_pause', {})
    await waitUntil(() => msgs[0]!.length === 1)
    expect(last(msgs[0]!)).toMatchObject({ votes: 1, status: 'open' })

    await leaveAll(clients)
  })

  it('eliminated players do not count toward needed and cannot vote; downed players can', async () => {
    const { room, clients, msgs } = await startedRun(3)
    const [a, b, c] = clients

    // c eliminated -> alive voters = 2 -> needed = 2. b downed (still votes).
    room.plainState.players.get(c.sessionId).eliminated = true
    room.plainState.players.get(b.sessionId).downed = true
    room.plainState.players.get(b.sessionId).bleedOutRemainingMs = 30_000

    c.send('vote_pause', {})
    await settle(150)
    expect(room.pauseVote).toBeNull()

    a.send('vote_pause', {})
    await waitUntil(() => msgs[0]!.length === 1)
    expect(last(msgs[0]!)).toMatchObject({ votes: 1, needed: 2, status: 'open' })

    c.send('vote_pause', {})
    await settle(150)
    expect(room.pauseVote.votes.size).toBe(1)

    b.send('vote_pause', {})
    await waitUntil(() => last(msgs[0]!)?.status === 'passed')
    expect(last(msgs[0]!)).toMatchObject({ votes: 2, needed: 2, status: 'passed', paused: true })

    await leaveAll(clients)
  })

  it('a leaver shrinks needed: the vote is re-broadcast and can pass on leave', async () => {
    const { room, clients, msgs } = await startedRun(3)
    const [a, b, c] = clients

    a.send('vote_pause', {})
    await waitUntil(() => msgs[0]!.length === 1)

    await b.leave()
    await waitUntil(() => msgs[0]!.length >= 2)
    expect(last(msgs[0]!)).toMatchObject({ kind: 'pause', votes: 1, needed: 2, status: 'open' })

    await c.leave()
    await waitUntil(() => last(msgs[0]!)?.status === 'passed')
    expect(last(msgs[0]!)).toMatchObject({ votes: 1, needed: 1, status: 'passed', paused: true })
    expect(room.votePaused).toBe(true)

    await leaveAll([a])
  })

  it('the initiator leaving with the only vote cancels the vote', async () => {
    const { room, clients, msgs } = await startedRun(3)
    const [a] = clients

    a.send('vote_pause', {})
    await waitUntil(() => msgs[1]!.length === 1)
    await a.leave()
    await waitUntil(() => last(msgs[1]!)?.status === 'cancelled')
    expect(last(msgs[1]!)).toMatchObject({ kind: 'pause', votes: 0, status: 'cancelled' })
    expect(room.pauseVote).toBeNull()

    await leaveAll(clients.slice(1))
  })

  it('a pause orphaned by the last alive voter leaving is released (T-06-15)', async () => {
    const { room, clients, msgs } = await startedRun(3)
    const [a, b, c] = clients

    a.send('vote_pause', {})
    await waitUntil(() => msgs[2]!.length === 1)
    b.send('vote_pause', {})
    await waitUntil(() => room.votePaused === true)
    expect(room.votePaused).toBe(true)

    // c is eliminated (spectator) and can never vote a resume.
    room.plainState.players.get(c.sessionId).eliminated = true
    room.plainState.players.get(c.sessionId).hp = 0

    await a.leave()
    await b.leave()

    // The pause is released and announced; the sim then sees a full-squad
    // defeat (only an eliminated player left) and the room ends.
    await waitUntil(() => last(msgs[2]!)?.paused === false)
    expect(last(msgs[2]!)).toMatchObject({ kind: 'resume', status: 'cancelled', paused: false })
    await waitUntil(() => room.state.roomPhase === 'ended')
    expect(room.votePaused).toBe(false)
    expect(room.state.result).toBe('defeated')
    expect(room.state.roomPhase).toBe('ended')

    await leaveAll([c])
  })

  it('mid-run leave removes the player, sets no survived result, and the run continues', async () => {
    const { room, clients } = await startedRun(3)
    const [a, b, c] = clients
    const leaverId = c.sessionId

    await c.leave()
    await waitUntil(() => !room.state.players.has(leaverId))

    expect(room.plainState.players.has(leaverId)).toBe(false)
    expect(room.state.players.has(leaverId)).toBe(false)
    expect(room.state.lobby.has(leaverId)).toBe(false)
    expect(room.plainState.result).toBeUndefined()
    expect(room.state.result).toBe('')
    // Difficulty snapshot is frozen at start (06-07/06-08 contract).
    expect(room.plainState.playerCount).toBe(3)

    const e0 = room.plainState.elapsedMs
    await settle(200)
    expect(room.plainState.elapsedMs).toBeGreaterThan(e0)
    expect(room.state.roomPhase).toBe('active')

    await leaveAll([a, b])
  })

  it('full-squad defeat ends the room: roomPhase ended and ticking stops', async () => {
    const { room, clients, msgs } = await startedRun(2)

    for (const c of clients) room.plainState.players.get(c.sessionId).hp = 0
    await waitUntil(() => room.state.result === 'defeated')
    expect(room.state.result).toBe('defeated')
    await waitUntil(() => room.state.roomPhase === 'ended')
    expect(room.state.roomPhase).toBe('ended')

    // Every player is downed on the wire at the moment of defeat.
    for (const c of clients) expect(room.state.players.get(c.sessionId).downed).toBe(true)

    const tick0 = room.plainState.tick
    await settle(300)
    expect(room.plainState.tick).toBe(tick0)

    // Votes are ignored once the run has ended.
    clients[0].send('vote_pause', {})
    await settle(150)
    expect(room.pauseVote).toBeNull()
    expect(msgs[0]!.length).toBe(0)

    await leaveAll(clients)
  })
})
