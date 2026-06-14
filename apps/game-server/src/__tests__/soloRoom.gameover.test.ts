/**
 * SoloRoom game over RED stubs (GAME-12/16, plan 05-01 Wave 0).
 *
 * GameStateSchema/PlayerSchema do not yet expose `result`, `kills`, or
 * per-player `weaponStats` (Task 1 added these to PlainGameState only), and
 * simulateTick does not yet set `result = 'defeated'` on hp=0 — every
 * assertion below is EXPECTED to FAIL RED until plan 05-06 (simulateTick
 * milestone/boss wiring) and plan 05-07 (SoloRoom integration) land.
 *
 * Pattern mirrors soloRoom.levelup.test.ts: boot(appConfig) once, cleanup()
 * between tests, JWT game-token helper for onAuth.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { ColyseusTestServer, boot } from '@colyseus/testing'
import jwt from 'jsonwebtoken'
import { appConfig } from '../app.config.js'
import { makeInitialState, simulateTick, mulberry32 } from '@game/shared'
import type { PlayerInput } from '@game/shared'

const TEST_JWT_SECRET = process.env['JWT_SECRET']!

function signTestGameToken(userId = 'test-user'): string {
  return jwt.sign({ userId, type: 'game' }, TEST_JWT_SECRET, { expiresIn: '5m' })
}

describe('SoloRoom game over (GAME-12/16)', () => {
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

  it('player hp reaching 0 sets state.result to defeated (GAME-12)', async () => {
    // RED: simulateTick does not yet set result on hp=0 (plan 05-06).
    const state = makeInitialState(1)
    state.players.get('p1')!.hp = 0
    const next = simulateTick(state, new Map<string, PlayerInput>(), mulberry32(1))
    expect(next.result).toBe('defeated')

    // RED: GameStateSchema has no `result` field yet (plan 05-07).
    const room = (await server.createRoom('solo_room', {})) as any
    server.sdk.auth.token = signTestGameToken()
    const client = await server.connectTo(room)
    expect(typeof room.state.result).toBe('string')

    await client.leave()
  })

  it('leaving the room with all players alive sets result to survived, not defeated (GAME-12)', async () => {
    const room = (await server.createRoom('solo_room', {})) as any

    server.sdk.auth.token = signTestGameToken()
    const client = await server.connectTo(room)

    await client.leave()
    await new Promise((resolve) => setTimeout(resolve, 50))

    // RED: GameStateSchema has no `result` field yet — onLeave does not set
    // 'survived' until plan 05-07.
    expect(room.state.result).toBe('survived')
  })

  it('game over summary exposes kills, elapsedMs, result, and per-player weaponStats (GAME-16)', async () => {
    const room = (await server.createRoom('solo_room', {})) as any

    server.sdk.auth.token = signTestGameToken()
    const client = await server.connectTo(room)

    // elapsedMs already exists on GameStateSchema (sanity check).
    expect(typeof room.state.elapsedMs).toBe('number')

    // RED: kills/result are not yet on GameStateSchema (plan 05-07).
    expect(typeof room.state.kills).toBe('number')
    expect(typeof room.state.result).toBe('string')

    // RED: weaponStats is not yet on PlayerSchema, keyed by slot index with
    // totalDamage/acquiredAtMs (plan 05-07).
    const player = room.state.players.get(client.sessionId)
    expect(player.weaponStats).toBeDefined()

    await client.leave()
  })
})
