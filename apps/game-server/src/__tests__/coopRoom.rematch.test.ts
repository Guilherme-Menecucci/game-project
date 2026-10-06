/**
 * CoopRoom post-defeat return to lobby (plan 06-15, gap closure of the 06-14
 * human checkpoint step 9 — ROOM-01/04/09).
 *
 * Developer decisions (locked 2026-10-06):
 * - The room survives a full-squad defeat: every still-connected player sees
 *   'ended' + result 'defeated' and stays connected.
 * - After RETURN_TO_LOBBY_DELAY_MS (default 2000ms) the server reopens the SAME
 *   room (same code) as a lobby: fresh run state, ready=false for everyone,
 *   classes kept, host = oldest connected client, room unlocked.
 * - The return is server-driven (timer) — no client message triggers it.
 * - The next run is genuinely new: re-seeded players, new PRNG seed,
 *   playerCount re-snapshotted from the CURRENT squad, anti-replay watermark
 *   reset (the client's seq restarts at 0 with the new Phaser game).
 *
 * NOTE: client.waitForNextPatch() is dead against @colyseus/sdk 0.17.42 —
 * waits poll state with a deadline. Defeat is forced the same way as the 06-09
 * votepause spec: every player's hp = 0 -> all downed -> full-squad defeat.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { ColyseusTestServer, boot } from '@colyseus/testing'
import jwt from 'jsonwebtoken'
import { appConfig } from '../app.config.js'

const TEST_JWT_SECRET = process.env['JWT_SECRET']!

/** Shortened return delay for the specs (still several 50ms patch intervals). */
const TEST_RETURN_DELAY_MS = 400

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

const NAMES = ['Alice', 'Bob', 'Carol', 'Dave'] as const

describe('CoopRoom post-defeat return to lobby (06-15)', () => {
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

  async function readyAll(room: any, clients: any[]): Promise<void> {
    for (const c of clients) c.send('ready', { ready: true })
    await waitUntil(() => clients.every((c) => room.state.lobby.get(c.sessionId)?.ready === true))
  }

  /** Lobby of n clients (host first), host vampire / p2 dwarf, then started. */
  async function startedRun(
    n: number,
    createOptions: Record<string, unknown> = {}
  ): Promise<{ room: any; clients: any[] }> {
    const room = (await server.createRoom('coop_room', createOptions)) as any
    const clients: any[] = []
    for (let i = 0; i < n; i++) {
      clients.push(await join(room, `user-${NAMES[i]!.toLowerCase()}`, NAMES[i]!))
    }
    await waitUntil(() => room.state.lobby.size === n)
    clients[0].send('select_class', { classId: 'vampire', weaponId: 'magic_wand' })
    clients[1].send('select_class', { classId: 'dwarf', weaponId: 'bible' })
    await waitUntil(
      () =>
        room.state.lobby.get(clients[0].sessionId)?.classId === 'vampire' &&
        room.state.lobby.get(clients[1].sessionId)?.classId === 'dwarf'
    )
    await readyAll(room, clients)
    clients[0].send('start_run', {})
    await waitUntil(() => room.state.roomPhase === 'active' && room.plainState.players.size === n)
    expect(room.state.roomPhase).toBe('active')
    return { room, clients }
  }

  /** Full-squad defeat (sim rule 06-03): every player at hp 0 -> all downed. */
  async function forceDefeat(room: any, clients: any[]): Promise<void> {
    for (const c of clients) {
      const p = room.plainState.players.get(c.sessionId)
      if (p) p.hp = 0
    }
    await waitUntil(() => room.state.roomPhase === 'ended')
    expect(room.state.result).toBe('defeated')
    expect(room.state.roomPhase).toBe('ended')
  }

  async function leaveAll(clients: any[]): Promise<void> {
    for (const c of clients) {
      try {
        await c.leave()
      } catch {
        // already gone
      }
    }
  }

  it('defeat keeps every client connected, then the same room reopens as a fresh lobby', async () => {
    const { room, clients } = await startedRun(2)
    const [host, p2] = clients
    expect(room.RETURN_TO_LOBBY_DELAY_MS).toBe(2000) // default
    room.RETURN_TO_LOBBY_DELAY_MS = TEST_RETURN_DELAY_MS
    const code = room.roomId

    // Client-side view of every patch: both must see 'ended' + 'defeated'.
    const seen: Array<Set<string>> = clients.map(() => new Set<string>())
    clients.forEach((c, i) => {
      c.onStateChange((s: any) => seen[i]!.add(`${s.roomPhase}|${s.result}`))
    })

    // Run-1 inputs move the anti-replay watermark.
    for (let seq = 1; seq <= 5; seq++) {
      host.send('input', { moveVector: { x: 1, y: 0 }, aimAngle: 0, actionFlags: 0, seq })
    }
    await waitUntil(() => room.lastSeq.get(host.sessionId) === 5)
    expect(room.lastSeq.get(host.sessionId)).toBe(5)
    await waitUntil(() => room.plainState.elapsedMs > 0)

    await forceDefeat(room, clients)
    await waitUntil(() => seen.every((s) => s.has('ended|defeated')))
    for (const s of seen) expect(s.has('ended|defeated')).toBe(true)

    // The reset is not immediate: the summary patch is delivered first.
    expect(room.state.roomPhase).toBe('ended')

    await waitUntil(() => room.state.roomPhase === 'lobby', TEST_RETURN_DELAY_MS + 2000)
    expect(room.state.roomPhase).toBe('lobby')
    expect(room.roomId).toBe(code)

    // Fresh run state on the wire and in the sim.
    expect(room.state.result).toBe('')
    expect(room.state.elapsedMs).toBe(0)
    expect(room.state.tick).toBe(0)
    expect(room.state.kills).toBe(0)
    for (const key of ['players', 'enemies', 'gems', 'projectiles', 'pickups', 'bosses']) {
      expect(room.state[key].size).toBe(0)
    }
    expect(room.plainState.players.size).toBe(0)
    expect(room.plainState.enemies.size).toBe(0)
    expect(room.plainState.elapsedMs).toBe(0)
    expect(room.plainState.tick).toBe(0)
    expect(room.plainState.result).toBeUndefined()
    expect(room.plainState.milestonesSpawned).toEqual({})
    // mode/playerCount back to the fresh-room defaults; tryStartRun re-snapshots.
    expect(room.plainState.mode).not.toBe('coop')
    expect(room.plainState.playerCount).toBe(1)

    // Base per-run bookkeeping cleared (T-06-24/25).
    expect(room.lastSeq.size).toBe(0)
    expect(room.prevLevels.size).toBe(0)
    expect(room.pendingUpgradeOptions.size).toBe(0)
    expect(room.upgradeTimeouts.size).toBe(0)
    expect(room.rareEventElapsedAtLastCheck).toBe(0)
    expect(room.pendingInputs.size).toBe(0)

    // Roster: exactly the connected clients, not ready, classes/names kept.
    expect(room.state.lobby.size).toBe(2)
    const hostEntry = room.state.lobby.get(host.sessionId)
    const p2Entry = room.state.lobby.get(p2.sessionId)
    expect(hostEntry.displayName).toBe('Alice')
    expect(hostEntry.classId).toBe('vampire')
    expect(hostEntry.ready).toBe(false)
    expect(hostEntry.isHost).toBe(true)
    expect(p2Entry.displayName).toBe('Bob')
    expect(p2Entry.classId).toBe('dwarf')
    expect(p2Entry.weaponId).toBe('bible')
    expect(p2Entry.ready).toBe(false)
    expect(p2Entry.isHost).toBe(false)

    // Unlocked again.
    expect(room.locked).toBe(false)

    // Clients are still connected and see the lobby.
    await waitUntil(() => clients.every((c) => c.state.roomPhase === 'lobby'))
    for (const c of clients) expect(c.state.roomPhase).toBe('lobby')

    // Nothing from run 1 mutates the reopened lobby (T-06-24).
    await settle(400)
    expect(room.state.roomPhase).toBe('lobby')
    expect(room.state.tick).toBe(0)
    expect(room.plainState.tick).toBe(0)
    expect(room.state.players.size).toBe(0)
    expect(room.state.lobby.get(host.sessionId).ready).toBe(false)
    expect(room.state.lobby.get(p2.sessionId).ready).toBe(false)

    await leaveAll(clients)
  })

  it('the reopened room is joinable by code and a public room is listed again in GET /rooms', async () => {
    const { room, clients } = await startedRun(2)
    room.RETURN_TO_LOBBY_DELAY_MS = TEST_RETURN_DELAY_MS

    // Sanity: a started run is locked and not listed.
    let res = await server.http.get('/rooms')
    expect((res.data as any[]).map((r) => r.roomId)).not.toContain(room.roomId)

    await forceDefeat(room, clients)
    await waitUntil(() => room.state.roomPhase === 'lobby', TEST_RETURN_DELAY_MS + 2000)
    expect(room.state.roomPhase).toBe('lobby')
    expect(room.locked).toBe(false)

    res = await server.http.get('/rooms')
    const entry = (res.data as any[]).find((r) => r.roomId === room.roomId)
    expect(entry).toBeDefined()
    expect(entry.clients).toBe(2)
    expect(entry.hostName).toBe('Alice')

    // A new player joins the same code and lands in the lobby, not ready.
    const p3 = await join(room, 'user-carol', 'Carol')
    await waitUntil(() => room.state.lobby.size === 3)
    const p3Entry = room.state.lobby.get(p3.sessionId)
    expect(p3Entry.displayName).toBe('Carol')
    expect(p3Entry.ready).toBe(false)
    expect(p3Entry.isHost).toBe(false)

    await leaveAll([...clients, p3])
  })

  it('a private room reopens joinable by code but stays hidden from GET /rooms', async () => {
    const { room, clients } = await startedRun(2, { isPrivate: true })
    room.RETURN_TO_LOBBY_DELAY_MS = TEST_RETURN_DELAY_MS

    await forceDefeat(room, clients)
    await waitUntil(() => room.state.roomPhase === 'lobby', TEST_RETURN_DELAY_MS + 2000)
    expect(room.state.roomPhase).toBe('lobby')

    const res = await server.http.get('/rooms')
    expect((res.data as any[]).map((r) => r.roomId)).not.toContain(room.roomId)

    const p3 = await join(room, 'user-carol', 'Carol')
    await waitUntil(() => room.state.lobby.size === 3)
    expect(room.state.lobby.get(p3.sessionId)).toBeDefined()

    await leaveAll([...clients, p3])
  })

  it('host leaving during ended -> oldest remaining client is host after the reset', async () => {
    const { room, clients } = await startedRun(3)
    const [host, p2, p3] = clients
    room.RETURN_TO_LOBBY_DELAY_MS = 800

    let hostChanged: any
    p2.onMessage('host_changed', (msg: any) => {
      hostChanged = msg
    })

    await forceDefeat(room, clients)
    await host.leave()
    await waitUntil(() => !room.state.lobby.has(host.sessionId))
    expect(room.state.roomPhase).toBe('ended')

    await waitUntil(() => room.state.roomPhase === 'lobby', 3000)
    await waitUntil(() => hostChanged !== undefined)
    expect(room.state.roomPhase).toBe('lobby')
    expect(room.state.lobby.size).toBe(2)
    expect(room.state.lobby.has(host.sessionId)).toBe(false)
    expect(room.state.lobby.get(p2.sessionId).isHost).toBe(true)
    expect(room.state.lobby.get(p3.sessionId).isHost).toBe(false)
    expect(hostChanged).toEqual({ hostSessionId: p2.sessionId })

    const res = await server.http.get('/rooms')
    const entry = (res.data as any[]).find((r) => r.roomId === room.roomId)
    expect(entry?.hostName).toBe('Bob')

    await leaveAll([p2, p3])
  })

  it('no host_changed broadcast when the host did not change', async () => {
    const { room, clients } = await startedRun(2)
    room.RETURN_TO_LOBBY_DELAY_MS = TEST_RETURN_DELAY_MS
    const hostMsgs: any[] = []
    for (const c of clients) c.onMessage('host_changed', (m: any) => hostMsgs.push(m))

    await forceDefeat(room, clients)
    await waitUntil(() => room.state.roomPhase === 'lobby', TEST_RETURN_DELAY_MS + 2000)
    await settle(200)
    expect(room.state.roomPhase).toBe('lobby')
    expect(hostMsgs).toEqual([])

    await leaveAll(clients)
  })

  it('second run is genuinely new: all-ready gate, re-seeded players, new seed, current playerCount, seq restarts at 0', async () => {
    const { room, clients } = await startedRun(3)
    const [host, p2, p3] = clients
    room.RETURN_TO_LOBBY_DELAY_MS = TEST_RETURN_DELAY_MS
    expect(room.plainState.playerCount).toBe(3)
    const seed1 = room.plainState.prngSeed
    const prng1 = room.prng

    host.send('input', { moveVector: { x: 1, y: 0 }, aimAngle: 0, actionFlags: 0, seq: 40 })
    await waitUntil(() => room.lastSeq.get(host.sessionId) === 40)

    // A mid-run leave: run 2 must snapshot the CURRENT squad (2), not run 1's 3.
    await p3.leave()
    await waitUntil(() => !room.state.lobby.has(p3.sessionId))

    await forceDefeat(room, [host, p2])
    await waitUntil(() => room.state.roomPhase === 'lobby', TEST_RETURN_DELAY_MS + 2000)
    expect(room.state.roomPhase).toBe('lobby')

    // A player who has not come back is not ready: the host cannot start.
    await readyAll(room, [host])
    host.send('start_run', {})
    await settle(250)
    expect(room.state.roomPhase).toBe('lobby')
    expect(room.locked).toBe(false)

    await readyAll(room, [host, p2])
    host.send('start_run', {})
    await waitUntil(() => room.state.roomPhase === 'active' && room.plainState.players.size === 2)
    expect(room.state.roomPhase).toBe('active')
    expect(room.locked).toBe(true)
    expect(room.plainState.mode).toBe('coop')
    expect(room.plainState.playerCount).toBe(2)
    expect(room.plainState.prngSeed).not.toBe(seed1)
    expect(room.prng).not.toBe(prng1)
    expect(room.state.result).toBe('')

    // Players re-seeded from the lobby entries (classes kept across runs).
    const hostPlayer = room.plainState.players.get(host.sessionId)
    const p2Player = room.plainState.players.get(p2.sessionId)
    expect(hostPlayer.classId).toBe('vampire')
    expect(p2Player.classId).toBe('dwarf')
    expect(p2Player.weapons).toEqual(['bible:1'])
    for (const p of [hostPlayer, p2Player]) {
      expect(p.hp).toBeGreaterThan(0)
      expect(p.level).toBe(1)
      expect(p.downed ?? false).toBe(false)
    }
    expect(room.state.players.size).toBe(2)

    // The new Phaser game restarts its seq at 0 — accepted in run 2 (T-06-25).
    host.send('input', { moveVector: { x: 1, y: 0 }, aimAngle: 0, actionFlags: 0, seq: 0 })
    await waitUntil(() => room.lastSeq.get(host.sessionId) === 0)
    expect(room.lastSeq.get(host.sessionId)).toBe(0)

    // The run actually simulates.
    await waitUntil(() => room.plainState.elapsedMs > 0)
    expect(room.plainState.elapsedMs).toBeGreaterThan(0)

    await leaveAll([host, p2])
  })

  it('all clients leaving during ended disposes cleanly and never resets', async () => {
    const { room, clients } = await startedRun(2)
    room.RETURN_TO_LOBBY_DELAY_MS = TEST_RETURN_DELAY_MS
    const resetSpy = vi.spyOn(room, 'resetToLobby')

    await forceDefeat(room, clients)
    await leaveAll(clients)
    await settle(TEST_RETURN_DELAY_MS + 400)

    expect(resetSpy).not.toHaveBeenCalled()
    expect(room.state.roomPhase).toBe('ended')
  })
})
