/**
 * CoopRoom downed/revive/eliminated wire mirror (ROOM-07/09/12, plan 06-09).
 *
 * The four co-op sim fields produced by applyDownedRevive (plan 06-03) must
 * reach the client through PlayerSchema:
 *   downed (boolean), bleedOutRemainingMs (uint16), reviveProgressTicks (uint8),
 *   eliminated (boolean)
 * - present with defaults from the very first serialization (Phase 5 lesson:
 *   never-assigned fields are omitted from the wire)
 * - hp 0 -> downed=true with a running bleed-out clock
 * - bleed-out expiry -> eliminated=true, downed=false, entry stays in players
 * - no client message can author any of them (ROOM-12)
 *
 * NOTE: client.waitForNextPatch() is dead against @colyseus/sdk 0.17.42 —
 * waits poll room-side state with a deadline. The real 50ms simulation
 * interval keeps ticking, so plainState is re-read right before every mutation.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { ColyseusTestServer, boot } from '@colyseus/testing'
import jwt from 'jsonwebtoken'
import { WORLD_W, BLEED_OUT_MS } from '@game/shared'
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

describe('CoopRoom downed/eliminated wire mirror (ROOM-07/09/12)', () => {
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

  /** Lobby flow (plan 06-08): 2 clients, everyone ready, host starts the run. */
  async function startedRun(): Promise<{ room: any; host: any; p2: any }> {
    const room = (await server.createRoom('coop_room', {})) as any
    const host = await join(room, 'user-alice', 'Alice')
    const p2 = await join(room, 'user-bob', 'Bob')
    await waitUntil(() => room.state.lobby.size === 2)
    for (const c of [host, p2]) c.send('ready', { ready: true })
    await waitUntil(() =>
      [host, p2].every((c) => room.state.lobby.get(c.sessionId)?.ready === true)
    )
    host.send('start_run', {})
    await waitUntil(() => room.state.roomPhase === 'active' && room.plainState.players.size === 2)
    expect(room.state.roomPhase).toBe('active')
    return { room, host, p2 }
  }

  /** Teammates spawn stacked at world center (inside REVIVE_RADIUS) — separate them. */
  function moveFarAway(room: any, sessionId: string): void {
    const p = room.plainState.players.get(sessionId)
    p.x = (p.x + Math.floor(WORLD_W / 2)) % WORLD_W
  }

  it('seeded PlayerSchema entries carry all four co-op fields with defaults', async () => {
    const { room, host, p2 } = await startedRun()

    for (const c of [host, p2]) {
      const json = room.state.players.get(c.sessionId).toJSON()
      expect(json).toMatchObject({
        downed: false,
        bleedOutRemainingMs: 0,
        reviveProgressTicks: 0,
        eliminated: false,
      })
    }

    await p2.leave()
    await host.leave()
  })

  it('hp 0 -> downed=true on the wire with a running bleed-out clock (ROOM-07)', async () => {
    const { room, host, p2 } = await startedRun()

    moveFarAway(room, p2.sessionId)
    room.plainState.players.get(host.sessionId).hp = 0

    await waitUntil(() => room.state.players.get(host.sessionId)?.downed === true)
    const ps = room.state.players.get(host.sessionId)
    expect(ps.downed).toBe(true)
    expect(ps.hp).toBe(0)
    expect(ps.bleedOutRemainingMs).toBeGreaterThan(0)
    expect(ps.bleedOutRemainingMs).toBeLessThanOrEqual(BLEED_OUT_MS)
    // No teammate in REVIVE_RADIUS -> no revive progress.
    expect(ps.reviveProgressTicks).toBe(0)
    expect(ps.eliminated).toBe(false)
    // Bleed-out clock counts down on the wire.
    const first = ps.bleedOutRemainingMs
    await waitUntil(() => room.state.players.get(host.sessionId).bleedOutRemainingMs < first)
    expect(room.state.players.get(host.sessionId).bleedOutRemainingMs).toBeLessThan(first)

    await p2.leave()
    await host.leave()
  })

  it('a teammate in range shows revive progress on the wire (ROOM-08)', async () => {
    const { room, host, p2 } = await startedRun()

    // Teammates spawn stacked: p2 stays inside REVIVE_RADIUS of the downed host.
    room.plainState.players.get(host.sessionId).hp = 0
    await waitUntil(() => (room.state.players.get(host.sessionId)?.reviveProgressTicks ?? 0) > 0)
    const ps = room.state.players.get(host.sessionId)
    expect(ps.downed).toBe(true)
    expect(ps.reviveProgressTicks).toBeGreaterThan(0)

    await p2.leave()
    await host.leave()
  })

  it('bleed-out expiry -> eliminated=true, downed=false, entry stays in players (ROOM-09)', async () => {
    const { room, host, p2 } = await startedRun()

    moveFarAway(room, p2.sessionId)
    room.plainState.players.get(host.sessionId).hp = 0
    await waitUntil(() => room.state.players.get(host.sessionId)?.downed === true)
    expect(room.state.players.get(host.sessionId)?.downed).toBe(true)

    // Force the clock to run out on the next tick.
    room.plainState.players.get(host.sessionId).bleedOutRemainingMs = 0
    await waitUntil(() => room.state.players.get(host.sessionId)?.eliminated === true)

    const ps = room.state.players.get(host.sessionId)
    expect(ps).toBeDefined()
    expect(ps.eliminated).toBe(true)
    expect(ps.downed).toBe(false)
    expect(ps.bleedOutRemainingMs).toBe(0)
    expect(ps.reviveProgressTicks).toBe(0)
    expect(room.state.players.has(host.sessionId)).toBe(true)

    await p2.leave()
    await host.leave()
  })

  it('no client message can author downed/eliminated/playerCount (ROOM-12, T-06-16)', async () => {
    const { room, host, p2 } = await startedRun()

    host.send('set_downed', { downed: true })
    host.send('downed', { downed: true, eliminated: true })
    host.send('playerCount', { playerCount: 1 })
    host.send('input', {
      moveVector: { x: 0, y: 0 },
      aimAngle: 0,
      actionFlags: 0,
      seq: 1,
      downed: true,
      eliminated: true,
    })
    await settle(200)

    const plain = room.plainState.players.get(host.sessionId)
    expect(plain.downed ?? false).toBe(false)
    expect(plain.eliminated ?? false).toBe(false)
    expect(room.plainState.playerCount).toBe(2)
    expect(room.state.players.get(host.sessionId).downed).toBe(false)
    expect(room.state.players.get(host.sessionId).eliminated).toBe(false)

    await p2.leave()
    await host.leave()
  })
})
