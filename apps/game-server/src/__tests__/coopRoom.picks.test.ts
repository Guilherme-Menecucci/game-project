/**
 * CoopRoom pick-without-pause + per-player rare events (ROOM-06, plan 06-09).
 *
 * Locked decision "Pick sem pausa": the world never pauses for a pick. The
 * picking player's moveVector is dropped server-side (filterInputs) while their
 * auto-fire continues; everyone else moves freely and elapsedMs keeps growing.
 *
 * Rare events (Pitfall 4): every alive player gets their OWN options, sent to
 * that client only — never one broadcast of a single player's options.
 *
 * A second level-up while a pick is pending is queued (never overwrites the
 * pending options / timeout) and offered after the first pick resolves.
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

describe('CoopRoom pick-without-pause + per-player rare events (ROOM-06)', () => {
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

  /** Per-client monotonic seq (anti-replay watermark is per session). */
  function inputSender(client: any): (mx: number, my: number) => void {
    let seq = 0
    return (mx, my) => {
      seq += 1
      client.send('input', { moveVector: { x: mx, y: my }, aimAngle: 0, actionFlags: 0, seq })
    }
  }

  /** Send a move input for every given sender once per ~tick for `ms`. */
  async function driveInputs(senders: Array<() => void>, ms: number): Promise<void> {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      for (const s of senders) s()
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
  }

  it('a pending pick freezes only the picking player; the world keeps ticking', async () => {
    const { room, host, p2 } = await startedRun()

    let levelUp: any = null
    host.onMessage('levelup', (msg: any) => {
      levelUp = msg
    })

    room.plainState.players.get(host.sessionId).level = 2
    await waitUntil(() => levelUp !== null)
    expect(levelUp).not.toBeNull()
    expect(levelUp.options.length).toBeGreaterThan(0)
    expect(room.pendingUpgradeOptions.has(host.sessionId)).toBe(true)

    const hostX0 = room.plainState.players.get(host.sessionId).x
    const p2X0 = room.plainState.players.get(p2.sessionId).x
    const elapsed0 = room.plainState.elapsedMs

    const moveHost = inputSender(host)
    const moveP2 = inputSender(p2)
    await driveInputs([() => moveHost(1, 0), () => moveP2(1, 0)], 400)

    // Picking player: moveVector dropped server-side -> position unchanged.
    expect(room.plainState.players.get(host.sessionId).x).toBe(hostX0)
    // Teammate moved freely.
    expect(room.plainState.players.get(p2.sessionId).x).not.toBe(p2X0)
    // No global pause: the world advanced, and the schema mirror kept up.
    expect(room.plainState.elapsedMs).toBeGreaterThan(elapsed0)
    expect(room.state.elapsedMs).toBeGreaterThan(elapsed0)
    expect(room.state.players.get(p2.sessionId).x).toBe(room.plainState.players.get(p2.sessionId).x)

    // Resolve the pick -> movement works again.
    let applied: any = null
    host.onMessage('upgrade_applied', (msg: any) => {
      applied = msg
    })
    host.send('upgrade_selected', { upgradeId: 'test_upgrade' })
    await waitUntil(() => applied !== null)
    expect(room.pendingUpgradeOptions.has(host.sessionId)).toBe(false)

    const hostX1 = room.plainState.players.get(host.sessionId).x
    await driveInputs([() => moveHost(1, 0)], 300)
    expect(room.plainState.players.get(host.sessionId).x).not.toBe(hostX1)

    await p2.leave()
    await host.leave()
  })

  it('a level-up while a pick is pending is queued and offered after resolution', async () => {
    const { room, host, p2 } = await startedRun()

    const levelUps: any[] = []
    host.onMessage('levelup', (msg: any) => {
      levelUps.push(msg)
    })
    let applied = 0
    host.onMessage('upgrade_applied', () => {
      applied += 1
    })

    room.plainState.players.get(host.sessionId).level = 2
    await waitUntil(() => levelUps.length === 1)
    expect(levelUps.length).toBe(1)
    const firstOptions = room.pendingUpgradeOptions.get(host.sessionId)
    const firstTimeout = room.upgradeTimeouts.get(host.sessionId)

    // Second level-up while the first pick is still pending.
    room.plainState.players.get(host.sessionId).level = 3
    await settle(200)
    // Not offered yet; pending options + timeout untouched.
    expect(levelUps.length).toBe(1)
    expect(room.pendingUpgradeOptions.get(host.sessionId)).toBe(firstOptions)
    expect(room.upgradeTimeouts.get(host.sessionId)).toBe(firstTimeout)

    host.send('upgrade_selected', { upgradeId: 'test_upgrade' })
    await waitUntil(() => applied === 1 && levelUps.length === 2)
    expect(applied).toBe(1)
    // Queued level-up offered AFTER upgrade_applied (client clears its picker on it).
    expect(levelUps.length).toBe(2)
    expect(room.pendingUpgradeOptions.has(host.sessionId)).toBe(true)

    await p2.leave()
    await host.leave()
  })

  it('rare events send each alive player its OWN options, never a broadcast (Pitfall 4)', async () => {
    const { room, host, p2 } = await startedRun()

    const hostMsgs: any[] = []
    const p2Msgs: any[] = []
    host.onMessage('rare_event', (msg: any) => hostMsgs.push(msg))
    p2.onMessage('rare_event', (msg: any) => p2Msgs.push(msg))

    room.plainState.elapsedMs = 180_000
    await waitUntil(() => hostMsgs.length > 0 && p2Msgs.length > 0)
    await settle(150)

    // Exactly one message per client (a per-player broadcast would deliver 2 each).
    expect(hostMsgs.length).toBe(1)
    expect(p2Msgs.length).toBe(1)
    expect(hostMsgs[0].options.length).toBeGreaterThan(0)
    expect(p2Msgs[0].options.length).toBeGreaterThan(0)

    // Each client's payload is exactly that player's own pending options.
    expect(hostMsgs[0].options).toEqual(room.pendingUpgradeOptions.get(host.sessionId))
    expect(p2Msgs[0].options).toEqual(room.pendingUpgradeOptions.get(p2.sessionId))
    expect(room.upgradeTimeouts.has(host.sessionId)).toBe(true)
    expect(room.upgradeTimeouts.has(p2.sessionId)).toBe(true)

    // The world did not pause for the rare event.
    const elapsed0 = room.plainState.elapsedMs
    await settle(200)
    expect(room.plainState.elapsedMs).toBeGreaterThan(elapsed0)

    await p2.leave()
    await host.leave()
  })

  it('rare events skip downed/eliminated players', async () => {
    const { room, host, p2 } = await startedRun()

    const hostMsgs: any[] = []
    const p2Msgs: any[] = []
    host.onMessage('rare_event', (msg: any) => hostMsgs.push(msg))
    p2.onMessage('rare_event', (msg: any) => p2Msgs.push(msg))

    // Call the hook directly with p2 eliminated.
    room.plainState.players.get(p2.sessionId).eliminated = true
    const paused = room.triggerRareEvent()
    expect(paused).toBe(false) // co-op never pauses the world for a rare event
    await waitUntil(() => hostMsgs.length > 0)
    await settle(150)

    expect(hostMsgs.length).toBe(1)
    expect(p2Msgs.length).toBe(0)
    expect(room.pendingUpgradeOptions.has(p2.sessionId)).toBe(false)

    await p2.leave()
    await host.leave()
  })
})
