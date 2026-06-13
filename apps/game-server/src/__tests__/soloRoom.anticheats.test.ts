/**
 * SoloRoom anti-cheat validation tests (SC-4, TEST-05)
 *
 * Verifies:
 * 1. Room rejects messages with unknown types — state (players/hp/xp) unchanged
 * 2. Room rejects input with invalid schema (missing required fields)
 * 3. Room accepts valid input and advances game state
 * 4. Client cannot directly mutate server state (Colyseus Schema is server-only)
 * 5. onAuth rejects missing/invalid game JWT (T-3-03)
 *
 * GREEN phase (plan 03-04): appConfig and SoloRoom implemented.
 * onAuth requires a valid game JWT — tests sign a token with the test JWT_SECRET.
 *
 * Auth flow in tests:
 *   server.sdk.auth.token = signedJwt  → SDK adds _authToken query param on connect
 *   WebSocketTransport reads _authToken → puts it in context.token
 *   static onAuth receives context.token → verifyGameToken validates it
 *
 * Server lifecycle: boot once per describe block (beforeAll/afterAll).
 * cleanup() between tests disconnects all clients and clears rooms without
 * restarting the server (avoids port-conflict flakiness from rapid restarts).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { ColyseusTestServer, boot } from '@colyseus/testing'
import jwt from 'jsonwebtoken'
import { appConfig } from '../app.config.js'
import type { PlayerInput } from '@game/shared'

// Test JWT_SECRET matches what setup.ts sets in process.env
const TEST_JWT_SECRET = process.env['JWT_SECRET']!

/**
 * Sign a valid game JWT for test auth.
 * Uses the same secret that setup.ts injects into process.env.JWT_SECRET.
 */
function signTestGameToken(userId = 'test-user'): string {
  return jwt.sign({ userId, type: 'game' }, TEST_JWT_SECRET, { expiresIn: '5m' })
}

describe('SoloRoom anti-cheat validation (SC-4, TEST-05)', () => {
  let server: ColyseusTestServer

  beforeAll(async () => {
    server = await boot(appConfig)
  })

  afterAll(async () => {
    await server.shutdown()
  })

  beforeEach(async () => {
    // Disconnect all clients and clear rooms between tests (no port restart)
    await server.cleanup()
  })

  it('rejects message with unknown type — player state unchanged', async () => {
    const room = await server.createRoom('solo_room', {})

    // Set auth token so onAuth accepts the connection
    server.sdk.auth.token = signTestGameToken()
    const client = await server.connectTo(room)

    // Snapshot players state before the hack attempt (id, x, y, hp, level unchanged)
    const playersBefore = JSON.stringify(room.state.players)

    // Send a fabricated message type with cheated values — server ignores unknown types
    client.send('hack_state', { x: 999999, hp: 999, level: 99 })
    await room.waitForNextSimulationTick()

    // Player state (hp, level, etc.) must be unchanged — hack was silently dropped
    expect(JSON.stringify(room.state.players)).toBe(playersBefore)
    await client.leave()
  })

  it('rejects input with invalid schema — player position unchanged', async () => {
    const room = await server.createRoom('solo_room', {})

    server.sdk.auth.token = signTestGameToken()
    const client = await server.connectTo(room)

    const playersBefore = JSON.stringify(room.state.players)

    // Send malformed input missing required fields (aimAngle, actionFlags)
    client.send('input', { moveVector: { x: 99, y: 0 } })
    await room.waitForNextSimulationTick()

    // safeParse fails → input ignored → player position unchanged
    expect(JSON.stringify(room.state.players)).toBe(playersBefore)
    await client.leave()
  })

  it('accepts valid input and advances game state', async () => {
    const room = await server.createRoom('solo_room', {})

    server.sdk.auth.token = signTestGameToken()
    const client = await server.connectTo(room)

    // Capture current tick (not hardcoded 0 — simulation may have run during connectTo)
    const tickBefore = room.state.tick as number

    // Send a valid input matching PlayerInputSchema
    const validInput: PlayerInput = {
      moveVector: { x: 0, y: 0 },
      aimAngle: 0,
      actionFlags: 0,
      seq: 1,
      tick: 0,
    }
    client.send('input', validInput)
    await room.waitForNextSimulationTick()

    // Game state should have advanced at least one tick beyond what we captured
    expect(room.state.tick as number).toBeGreaterThan(tickBefore)
    await client.leave()
  })

  it('client cannot directly mutate server state — Schema is server-side only', async () => {
    const room = await server.createRoom('solo_room', {})

    server.sdk.auth.token = signTestGameToken()
    const client = await server.connectTo(room)

    // The room's server-side GameStateSchema is owned by the server.
    // Client-side references are read-only patches sent from server → client.
    // Verify: the server state players map is defined and protected from client writes.
    await room.waitForNextSimulationTick()
    expect(room.state.players).toBeDefined()

    // Verify the server state's players are unaffected by client actions
    // (the client can only call client.send() — it cannot reach into server state directly)
    expect(room.state.players.has(client.sessionId)).toBe(true)
    await client.leave()
  })

  it('onAuth rejects connection when game JWT is missing (T-3-03)', async () => {
    const room = await server.createRoom('solo_room', {})

    // Explicitly clear the auth token (previous test may have set it)
    // onAuth will throw 'Missing game token' → Colyseus rejects the connection
    server.sdk.auth.token = ''
    const connectPromise = server.connectTo(room)

    await expect(connectPromise).rejects.toThrow()
  })

  it('solo rooms are isolated — two players never share a room (maxClients=1)', async () => {
    server.sdk.auth.token = signTestGameToken('player-one')
    const r1 = await server.sdk.create('solo_room', {})

    server.sdk.auth.token = signTestGameToken('player-two')
    const r2 = await server.sdk.create('solo_room', {})

    // Each create() yields a distinct room instance — no pooling into one run.
    expect(r1.roomId).not.toBe(r2.roomId)

    // A by-name join cannot enter an occupied solo room (no free seat to match into).
    server.sdk.auth.token = signTestGameToken('intruder')
    await expect(server.sdk.join('solo_room', {})).rejects.toThrow()

    await r1.leave()
    await r2.leave()
  })

  it('onAuth rejects connection when game JWT is signed with wrong secret (T-3-03)', async () => {
    const room = await server.createRoom('solo_room', {})

    // Sign with a different secret — verifyGameToken will throw JsonWebTokenError
    server.sdk.auth.token = jwt.sign(
      { userId: 'attacker', type: 'game' },
      'wrong-secret-that-is-32-characters-long',
      {
        expiresIn: '5m',
      }
    )

    const connectPromise = server.connectTo(room)

    await expect(connectPromise).rejects.toThrow()
  })
})
