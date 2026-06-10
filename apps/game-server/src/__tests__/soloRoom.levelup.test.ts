/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { ColyseusTestServer, boot } from '@colyseus/testing'
import jwt from 'jsonwebtoken'
import { appConfig } from '../app.config.js'

const TEST_JWT_SECRET = process.env['JWT_SECRET']!

function signTestGameToken(userId = 'test-user'): string {
  return jwt.sign({ userId, type: 'game' }, TEST_JWT_SECRET, { expiresIn: '5m' })
}

describe('SoloRoom levelup, pause, and rare event', () => {
  let server: ColyseusTestServer

  beforeAll(async () => {
    server = await boot(appConfig)
  })

  afterAll(async () => {
    await server.shutdown()
  })

  beforeEach(async () => {
    await server.cleanup()
    vi.useRealTimers()
  })

  it('pauses simulation on level up and emits levelup event with 3 options (GAME-08)', async () => {
    const room = (await server.createRoom('solo_room', {})) as any

    server.sdk.auth.token = signTestGameToken()
    const client = await server.connectTo(room)

    // Setup levelup message listener
    let levelUpMsg: any = null
    client.onMessage('levelup', (msg) => {
      levelUpMsg = msg
    })

    // Advance player level in plainState to trigger levelup
    const player = room.plainState.players.get(client.sessionId)
    player.level = 2

    // Force a tick so levelup checks run
    await room.tick()

    // Wait short time for message delivery
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(room.simulationPaused).toBe(true)
    expect(levelUpMsg).not.toBeNull()
    expect(levelUpMsg.options.length).toBe(3)

    await client.leave()
  })

  it('resumes simulation after upgrade_selected (GAME-08)', async () => {
    const room = (await server.createRoom('solo_room', {})) as any

    server.sdk.auth.token = signTestGameToken()
    const client = await server.connectTo(room)

    // Trigger levelup
    const player = room.plainState.players.get(client.sessionId)
    player.level = 2
    await room.tick()

    expect(room.simulationPaused).toBe(true)

    // Send selection
    client.send('upgrade_selected', { upgradeId: 'test_upgrade' })

    // Wait for the room to handle selection and resume
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(room.simulationPaused).toBe(false)

    await client.leave()
  })

  it('auto-selects random option after 15s timeout (D-14)', async () => {
    vi.useFakeTimers()
    const room = (await server.createRoom('solo_room', {})) as any

    server.sdk.auth.token = signTestGameToken()
    const client = await server.connectTo(room)

    // Trigger levelup
    const player = room.plainState.players.get(client.sessionId)
    player.level = 2
    await room.tick()

    expect(room.simulationPaused).toBe(true)

    // Advance time by 15 seconds (15000ms)
    // Tick both room.clock and vi timers for robustness
    room.clock.tick(15000)
    await vi.advanceTimersByTimeAsync(15000)

    expect(room.simulationPaused).toBe(false)
    expect(player.weapons.length + player.passives.length).toBeGreaterThan(0)

    await client.leave()
  })

  it('does not pause when player levels up but there are no upgrade options available', async () => {
    const room = (await server.createRoom('solo_room', {})) as any

    server.sdk.auth.token = signTestGameToken()
    const client = await server.connectTo(room)

    const player = room.plainState.players.get(client.sessionId)
    player.weapons = ['holy_wand', 'thousand_edge', 'garlic:5', 'bible:5']
    player.passives = ['boots:5', 'spinach:5']

    let levelUpMsg: any = null
    client.onMessage('levelup', (msg) => {
      levelUpMsg = msg
    })

    player.level = 2
    await room.tick()

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(room.simulationPaused).toBe(false)
    expect(levelUpMsg).toBeNull()

    await client.leave()
  })

  it('fires rare_event after elapsed threshold (GAME-11)', async () => {
    const room = (await server.createRoom('solo_room', {})) as any

    server.sdk.auth.token = signTestGameToken()
    const client = await server.connectTo(room)

    let rareEventMsg: any = null
    client.onMessage('rare_event', (msg) => {
      rareEventMsg = msg
    })

    // Mock the elapsed time on the plainState and tick once to trigger rare event
    room.plainState.elapsedMs = 180000
    await room.tick()

    // Wait short time for any callback execution
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(rareEventMsg).not.toBeNull()
    expect(rareEventMsg.options.length).toBe(3)
    expect(room.simulationPaused).toBe(true)

    await client.leave()
  })
})
