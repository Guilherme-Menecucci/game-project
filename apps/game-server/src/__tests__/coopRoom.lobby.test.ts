/**
 * CoopRoom lobby lifecycle (ROOM-01/02/03/04, plan 06-08).
 *
 * Multi-client integration spec over the real Colyseus test server:
 * - roomId is the 6-char unambiguous room code (06-04 alphabet)
 * - GET /rooms lists public unlocked lobbies with hostName + counts, carries
 *   helmet headers, and never leaks private rooms (T-06-13)
 * - lobby roster entries are server-attested (displayName from the game JWT,
 *   never a client-sent name — T-06-08), host = oldest client
 * - start_run gate: host-only (T-06-11), 2+ players, everyone ready
 * - start: lock + roomPhase 'active' + mode 'coop' + frozen playerCount + seed
 * - late-join after start is rejected (lock + onJoin guard — T-06-12)
 * - host migration in the lobby to the oldest remaining client
 *
 * NOTE: client.waitForNextPatch() is dead against @colyseus/sdk 0.17.42 (see
 * soloRoom.gameover.test.ts) — every wait below polls room-side state with a
 * deadline instead. Tokens are set on server.sdk.auth.token right before each
 * sequential connect (context.token wins over options.token in onAuth).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { ColyseusTestServer, boot } from '@colyseus/testing'
import jwt from 'jsonwebtoken'
import { appConfig } from '../app.config.js'

const TEST_JWT_SECRET = process.env['JWT_SECRET']!
const ROOM_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/

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

describe('CoopRoom lobby lifecycle (ROOM-01/02/03/04)', () => {
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

  /** Sequential, per-client token: never connect two clients in parallel. */
  async function join(room: any, userId: string, displayName: string): Promise<any> {
    server.sdk.auth.token = signTestGameToken(userId, displayName)
    return server.connectTo(room)
  }

  /** Create a lobby with two connected clients: host (Alice) + p2 (Bob). */
  async function twoPlayerLobby(): Promise<{ room: any; host: any; p2: any }> {
    const room = (await server.createRoom('coop_room', {})) as any
    const host = await join(room, 'user-alice', 'Alice')
    const p2 = await join(room, 'user-bob', 'Bob')
    await waitUntil(() => room.state.lobby.size === 2)
    return { room, host, p2 }
  }

  async function readyAll(room: any, clients: any[]): Promise<void> {
    for (const c of clients) c.send('ready', { ready: true })
    await waitUntil(() => clients.every((c) => room.state.lobby.get(c.sessionId)?.ready === true))
  }

  it('assigns a 6-char unambiguous room code as the roomId (ROOM-02)', async () => {
    const room = (await server.createRoom('coop_room', {})) as any
    expect(room.roomId).toMatch(ROOM_CODE_RE)
    expect(room.maxClients).toBe(4)
  })

  it('GET /rooms lists a public lobby with hostName and counts, with helmet headers (ROOM-01)', async () => {
    const room = (await server.createRoom('coop_room', {})) as any
    const host = await join(room, 'user-alice', 'Alice')
    await waitUntil(() => room.state.lobby.size === 1)

    const res = await server.http.get('/rooms')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(Array.isArray(res.data)).toBe(true)
    const entry = (res.data as any[]).find((r) => r.roomId === room.roomId)
    expect(entry).toBeDefined()
    expect(entry.hostName).toBe('Alice')
    expect(entry.clients).toBe(1)
    expect(entry.maxClients).toBe(4)

    await host.leave()
  })

  it('private rooms are hidden from GET /rooms but joinable by code (ROOM-02, T-06-13)', async () => {
    const room = (await server.createRoom('coop_room', { isPrivate: true })) as any
    const host = await join(room, 'user-alice', 'Alice')
    await waitUntil(() => room.state.lobby.size === 1)

    const res = await server.http.get('/rooms')
    const ids = (res.data as any[]).map((r) => r.roomId)
    expect(ids).not.toContain(room.roomId)

    // Invite path: a second client connects straight to the code.
    const p2 = await join(room, 'user-bob', 'Bob')
    await waitUntil(() => room.state.lobby.size === 2)
    expect(room.state.lobby.get(p2.sessionId)).toBeDefined()

    await p2.leave()
    await host.leave()
  })

  it('lobby roster carries the token displayName, ready=false and host = oldest client (ROOM-01, T-06-08)', async () => {
    const room = (await server.createRoom('coop_room', {})) as any
    const host = await join(room, 'user-alice', 'Alice')
    // A client-sent name in join options must be ignored.
    server.sdk.auth.token = signTestGameToken('user-bob', 'Bob')
    const p2 = await server.connectTo(room, { displayName: 'Spoofed' })
    await waitUntil(() => room.state.lobby.size === 2)

    expect(room.state.roomPhase).toBe('lobby')
    const hostEntry = room.state.lobby.get(host.sessionId)
    const p2Entry = room.state.lobby.get(p2.sessionId)
    expect(hostEntry.displayName).toBe('Alice')
    expect(p2Entry.displayName).toBe('Bob')
    expect(hostEntry.ready).toBe(false)
    expect(p2Entry.ready).toBe(false)
    expect(hostEntry.isHost).toBe(true)
    expect(p2Entry.isHost).toBe(false)

    // No players are simulated while in the lobby.
    expect(room.plainState.players.size).toBe(0)

    await p2.leave()
    await host.leave()
  })

  it('select_class stores classId/weaponId on the sender lobby entry; invalid payloads are dropped', async () => {
    const { room, host, p2 } = await twoPlayerLobby()

    p2.send('select_class', { classId: 'dwarf', weaponId: 'garlic' })
    await waitUntil(() => room.state.lobby.get(p2.sessionId)?.classId === 'dwarf')
    const p2Entry = room.state.lobby.get(p2.sessionId)
    expect(p2Entry.classId).toBe('dwarf')
    expect(p2Entry.weaponId).toBe('garlic')

    // Host's entry is untouched by p2's message.
    expect(room.state.lobby.get(host.sessionId).classId).not.toBe('dwarf')

    p2.send('select_class', { classId: 'dragon', weaponId: 'garlic' })
    await settle()
    expect(room.state.lobby.get(p2.sessionId).classId).toBe('dwarf')

    await p2.leave()
    await host.leave()
  })

  it('ready toggles the sender lobby entry', async () => {
    const { room, host, p2 } = await twoPlayerLobby()

    p2.send('ready', { ready: true })
    await waitUntil(() => room.state.lobby.get(p2.sessionId)?.ready === true)
    expect(room.state.lobby.get(p2.sessionId).ready).toBe(true)
    expect(room.state.lobby.get(host.sessionId).ready).toBe(false)

    p2.send('ready', { ready: false })
    await waitUntil(() => room.state.lobby.get(p2.sessionId)?.ready === false)
    expect(room.state.lobby.get(p2.sessionId).ready).toBe(false)

    await p2.leave()
    await host.leave()
  })

  it('start_run from a non-host is ignored (T-06-11)', async () => {
    const { room, host, p2 } = await twoPlayerLobby()
    await readyAll(room, [host, p2])

    p2.send('start_run', {})
    await settle()
    expect(room.locked).toBe(false)
    expect(room.state.roomPhase).toBe('lobby')

    await p2.leave()
    await host.leave()
  })

  it('start_run with only one player is ignored (ROOM-03: 2-4 players)', async () => {
    const room = (await server.createRoom('coop_room', {})) as any
    const host = await join(room, 'user-alice', 'Alice')
    await waitUntil(() => room.state.lobby.size === 1)
    await readyAll(room, [host])

    host.send('start_run', {})
    await settle()
    expect(room.locked).toBe(false)
    expect(room.state.roomPhase).toBe('lobby')

    await host.leave()
  })

  it('start_run while any player is not ready is ignored (ROOM-04)', async () => {
    const { room, host, p2 } = await twoPlayerLobby()
    await readyAll(room, [host])

    host.send('start_run', {})
    await settle()
    expect(room.locked).toBe(false)
    expect(room.state.roomPhase).toBe('lobby')
    expect(room.plainState.players.size).toBe(0)

    await p2.leave()
    await host.leave()
  })

  it('host start_run with everyone ready locks, activates and seeds every player (ROOM-03/04)', async () => {
    const { room, host, p2 } = await twoPlayerLobby()

    p2.send('select_class', { classId: 'vampire', weaponId: 'knife' })
    await waitUntil(() => room.state.lobby.get(p2.sessionId)?.classId === 'vampire')
    await readyAll(room, [host, p2])

    host.send('start_run', {})
    await waitUntil(() => room.state.roomPhase === 'active')

    expect(room.locked).toBe(true)
    expect(room.state.roomPhase).toBe('active')
    expect(room.plainState.mode).toBe('coop')
    expect(room.plainState.playerCount).toBe(2)
    expect(room.plainState.players.size).toBe(2)

    const p2Player = room.plainState.players.get(p2.sessionId)
    expect(p2Player.classId).toBe('vampire')
    expect(p2Player.weapons[0]).toBe('knife:1')
    expect(room.plainState.players.get(host.sessionId)).toBeDefined()
    expect(room.state.players.size).toBe(2)

    // Lobby roster stays intact in-run (HUD reads displayName from it).
    expect(room.state.lobby.size).toBe(2)

    // A second start_run must not re-seed or recompute playerCount.
    host.send('start_run', {})
    await settle()
    expect(room.plainState.playerCount).toBe(2)
    expect(room.plainState.players.size).toBe(2)

    await p2.leave()
    await host.leave()
  })

  it('rejects a join after the run started (lock + onJoin guard, T-06-12)', async () => {
    const { room, host, p2 } = await twoPlayerLobby()
    await readyAll(room, [host, p2])

    host.send('start_run', {})
    await waitUntil(() => room.state.roomPhase === 'active')
    expect(room.locked).toBe(true)

    await expect(join(room, 'user-carol', 'Carol')).rejects.toThrow()

    // Defense in depth: the onJoin guard rejects even if a seat slipped past lock().
    const fakeClient = {
      sessionId: 'late-seat',
      auth: { userId: 'user-dave', displayName: 'Dave' },
    }
    await expect(
      Promise.resolve().then(() => room.onJoin(fakeClient, {}, fakeClient.auth))
    ).rejects.toThrow()
    expect(room.state.lobby.get('late-seat')).toBeUndefined()
    expect(room.plainState.players.size).toBe(2)

    await p2.leave()
    await host.leave()
  })

  it('host leaving the lobby migrates host to the oldest remaining client (locked decision)', async () => {
    const room = (await server.createRoom('coop_room', {})) as any
    const host = await join(room, 'user-alice', 'Alice')
    const p2 = await join(room, 'user-bob', 'Bob')
    const p3 = await join(room, 'user-carol', 'Carol')
    await waitUntil(() => room.state.lobby.size === 3)

    let hostChanged: any
    p2.onMessage('host_changed', (msg: any) => {
      hostChanged = msg
    })

    await host.leave()
    await waitUntil(
      () => room.state.lobby.get(p2.sessionId)?.isHost === true && hostChanged !== undefined
    )

    expect(room.state.lobby.has(host.sessionId)).toBe(false)
    expect(room.state.lobby.get(p2.sessionId).isHost).toBe(true)
    expect(room.state.lobby.get(p3.sessionId).isHost).toBe(false)
    expect(hostChanged).toEqual({ hostSessionId: p2.sessionId })

    // The listing follows the new host.
    const res = await server.http.get('/rooms')
    const entry = (res.data as any[]).find((r) => r.roomId === room.roomId)
    expect(entry?.hostName).toBe('Bob')

    // The new host can start the run.
    await readyAll(room, [p2, p3])
    p2.send('start_run', {})
    await waitUntil(() => room.state.roomPhase === 'active')
    expect(room.locked).toBe(true)
    expect(room.plainState.playerCount).toBe(2)

    await p3.leave()
    await p2.leave()
  })
})
