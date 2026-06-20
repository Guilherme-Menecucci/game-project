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
import { makeInitialState, simulateTick, mulberry32, MILESTONE_MS } from '@game/shared'
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

  it('milestone boss spawn serializes onto the wire (GAME-13)', { timeout: 15000 }, async () => {
    const room = (await server.createRoom('solo_room', {})) as any

    server.sdk.auth.token = signTestGameToken()
    const client = await server.connectTo(room)

    // Force the milestone-spawn deterministically instead of waiting on the
    // real 20-minute clock. Neutralize the unrelated rare-event check (GAME-11)
    // first: tick()'s rare-event branch fires whenever elapsedMs >= 180_000ms
    // and rareEventElapsedAtLastCheck === 0, pausing simulation and returning
    // BEFORE mirrorStateToSchema runs — which would leave room.state.bosses
    // empty even though plainState.bosses was populated correctly.
    room.plainState.elapsedMs = MILESTONE_MS.biomeBoss + 1000
    room.rareEventElapsedAtLastCheck = room.plainState.elapsedMs

    await room.tick()
    expect(room.simulationPaused).toBe(false)

    // Flush the encoded patch through the wire to the connected client's
    // locally-decoded state. NOTE: client.waitForNextPatch() (the documented
    // @colyseus/testing helper) is a no-op against @colyseus/sdk@0.17.42 — it
    // monkey-patches ClientRoom.prototype['patch'], but this SDK version
    // applies patches via this.serializer.patch(...) inside the internal
    // message dispatcher, not a 'patch' method, so the deferred never
    // resolves. Poll the actual precondition instead: the room's own
    // patch interval (DEFAULT_PATCH_RATE=50ms) broadcasts automatically over
    // the real ws:// connection and the client applies it via onStateChange.
    const deadline = Date.now() + 3000
    while ((client.state.bosses?.size ?? 0) === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    // Server-side: spawn + mirror sanity check.
    expect(room.state.bosses.size).toBeGreaterThan(0)
    const serverBoss = room.state.bosses.get('boss_patient_zero')
    expect(serverBoss).toBeDefined()
    expect(typeof serverBoss.hp).toBe('number')
    expect(typeof serverBoss.maxHp).toBe('number')
    expect(typeof serverBoss.x).toBe('number')
    expect(typeof serverBoss.y).toBe('number')
    expect(serverBoss.bossKey).toBe('patient_zero')
    expect(typeof serverBoss.name).toBe('string')
    expect(serverBoss.name.length).toBeGreaterThan(0)

    // Client-side: the actual wire-serialization assertion this test exists
    // for — confirms BossSchema's uint32 fields are not omitted from the
    // decoded JSON (the exact "uint32 omitted unless explicitly assigned"
    // gotcha documented in STATE.md for WeaponStatsSchema).
    expect(client.state.bosses.size).toBeGreaterThan(0)
    const clientBoss = client.state.bosses.get('boss_patient_zero')
    expect(clientBoss).toBeDefined()
    expect(typeof clientBoss.hp).toBe('number')
    expect(typeof clientBoss.maxHp).toBe('number')
    expect(typeof clientBoss.x).toBe('number')
    expect(typeof clientBoss.y).toBe('number')
    expect(clientBoss.bossKey).toBe('patient_zero')

    await client.leave()
  })
})
