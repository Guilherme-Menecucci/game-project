/**
 * SoloRoom anti-replay seq enforcement tests (Phase 6 Wave 0, ROOM-12 / T-06-01).
 *
 * Verifies:
 * 1. An input whose seq is <= the last accepted seq for that session is
 *    silently dropped (replay/reorder protection) — pendingInputs keeps the
 *    previously accepted frame.
 * 2. Monotonically increasing seq values are all accepted.
 * 3. lastSeq is keyed per session and cleaned in onLeave (Pitfall 7): a fresh
 *    connection starts at seq 0 and its inputs are accepted.
 *
 * Test technique: simulationPaused = true stops tick() from consuming
 * pendingInputs, so the map can be inspected after each message. Server-side
 * room.waitForMessage('input') resolves AFTER the room's registered handler
 * ran (see @colyseus/testing Room.ext) — never client.waitForNextPatch, which
 * is dead in @colyseus/sdk 0.17.42 (STATE.md decision).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { ColyseusTestServer, boot } from '@colyseus/testing'
import jwt from 'jsonwebtoken'
import { appConfig } from '../app.config.js'
import type { PlayerInput } from '@game/shared'

// Test JWT_SECRET matches what setup.ts sets in process.env
const TEST_JWT_SECRET = process.env['JWT_SECRET']!

function signTestGameToken(userId = 'test-user'): string {
  return jwt.sign({ userId, type: 'game' }, TEST_JWT_SECRET, { expiresIn: '5m' })
}

function makeInput(seq: number, mx = 0, my = 0): PlayerInput {
  return {
    moveVector: { x: mx, y: my },
    aimAngle: 0,
    actionFlags: 0,
    seq,
    tick: 0,
  }
}

describe('SoloRoom anti-replay seq enforcement (T-06-01)', () => {
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

  it('drops replayed and reordered frames — only the first seq 5 is applied', async () => {
    const room = await server.createRoom('solo_room', {})
    // Freeze the tick loop so pendingInputs is not consumed between sends.
    ;(room as unknown as { simulationPaused: boolean }).simulationPaused = true

    server.sdk.auth.token = signTestGameToken()
    const client = await server.connectTo(room)
    const pendingInputs = (room as unknown as { pendingInputs: Map<string, PlayerInput> })
      .pendingInputs

    // seq 5 with a distinctive moveVector — accepted (first frame)
    let received = room.waitForMessage('input')
    client.send('input', makeInput(5, 1, 0))
    await received
    expect(pendingInputs.get(client.sessionId)?.seq).toBe(5)
    expect(pendingInputs.get(client.sessionId)?.moveVector.x).toBe(1)

    // seq 3 (reordered/stale frame) — must be silently dropped
    received = room.waitForMessage('input')
    client.send('input', makeInput(3, -1, 0))
    await received
    expect(pendingInputs.get(client.sessionId)?.seq).toBe(5)
    expect(pendingInputs.get(client.sessionId)?.moveVector.x).toBe(1)

    // seq 5 replay (duplicate frame) — must be silently dropped
    received = room.waitForMessage('input')
    client.send('input', makeInput(5, -1, 0))
    await received
    expect(pendingInputs.get(client.sessionId)?.seq).toBe(5)
    expect(pendingInputs.get(client.sessionId)?.moveVector.x).toBe(1)

    await client.leave()
  })

  it('accepts monotonically increasing seq values', async () => {
    const room = await server.createRoom('solo_room', {})
    ;(room as unknown as { simulationPaused: boolean }).simulationPaused = true

    server.sdk.auth.token = signTestGameToken()
    const client = await server.connectTo(room)
    const pendingInputs = (room as unknown as { pendingInputs: Map<string, PlayerInput> })
      .pendingInputs

    let received = room.waitForMessage('input')
    client.send('input', makeInput(5, 1, 0))
    await received
    expect(pendingInputs.get(client.sessionId)?.seq).toBe(5)

    received = room.waitForMessage('input')
    client.send('input', makeInput(6, 0, 1))
    await received
    expect(pendingInputs.get(client.sessionId)?.seq).toBe(6)
    expect(pendingInputs.get(client.sessionId)?.moveVector.y).toBe(1)

    await client.leave()
  })

  it('lastSeq is per-session and cleaned on leave — reconnect starts at seq 0 (Pitfall 7)', async () => {
    const room = await server.createRoom('solo_room', {})
    // Keep the room alive across the disconnect so the same instance can be rejoined.
    ;(room as unknown as { autoDispose: boolean }).autoDispose = false
    ;(room as unknown as { simulationPaused: boolean }).simulationPaused = true

    server.sdk.auth.token = signTestGameToken()
    const first = await server.connectTo(room)
    const firstSessionId = first.sessionId
    const internals = room as unknown as {
      pendingInputs: Map<string, PlayerInput>
      lastSeq: Map<string, number>
    }

    // Advance the first session's seq well past 0
    const received = room.waitForMessage('input')
    first.send('input', makeInput(5, 1, 0))
    await received
    expect(internals.pendingInputs.get(firstSessionId)?.seq).toBe(5)

    await first.leave()

    // onLeave must clean the per-session lastSeq entry (keying by userId would
    // freeze a rejoining player at their old seq watermark — Pitfall 7)
    expect(internals.lastSeq.has(firstSessionId)).toBe(false)

    // Fresh session: seq 0 must be accepted
    server.sdk.auth.token = signTestGameToken()
    const second = await server.connectTo(room)
    ;(room as unknown as { simulationPaused: boolean }).simulationPaused = true

    const received2 = room.waitForMessage('input')
    second.send('input', makeInput(0, 0, 1))
    await received2
    expect(internals.pendingInputs.get(second.sessionId)?.seq).toBe(0)
    expect(internals.pendingInputs.get(second.sessionId)?.moveVector.y).toBe(1)

    await second.leave()
  })
})
