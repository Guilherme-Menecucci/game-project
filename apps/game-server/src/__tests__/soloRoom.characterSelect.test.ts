/**
 * SoloRoom character select RED stubs (CHAR-01/02/03, plan 05-01 Wave 0).
 *
 * onJoin does not yet read `client.options.classId`/`weaponId`, and
 * `characterCatalog` is an empty `{}` stub (Task 1 barrel) — every assertion
 * below is EXPECTED to FAIL RED until plan 05-08 wires
 * `CharacterSelectSchema.safeParse(client.options)` + catalog-driven seeding
 * into `SoloRoom.onJoin` (catalog itself lands in plan 05-02).
 *
 * Pattern mirrors soloRoom.levelup.test.ts: boot(appConfig) once, cleanup()
 * between tests, JWT game-token helper for onAuth.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { ColyseusTestServer, boot } from '@colyseus/testing'
import jwt from 'jsonwebtoken'
import { appConfig } from '../app.config.js'
import { characterCatalog } from '@game/shared'

const TEST_JWT_SECRET = process.env['JWT_SECRET']!

function signTestGameToken(userId = 'test-user'): string {
  return jwt.sign({ userId, type: 'game' }, TEST_JWT_SECRET, { expiresIn: '5m' })
}

describe('SoloRoom character select (CHAR-01/02/03)', () => {
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

  it('onJoin with valid classId/weaponId seeds player stats from characterCatalog (CHAR-01/02)', async () => {
    const room = (await server.createRoom('solo_room', {})) as any

    server.sdk.auth.token = signTestGameToken()
    const client = await server.connectTo(room, { classId: 'dwarf', weaponId: 'knife' })

    const player = room.plainState.players.get(client.sessionId)

    // RED: characterCatalog is `{}` (Task 1 stub) — `characterCatalog.dwarf` is
    // undefined, so this lookup throws/compares against undefined. onJoin also
    // does not read client.options yet, so player.maxHp/speed/damageMultiplier/
    // fireRateMultiplier are the hardcoded defaults (100/10_000/undefined/undefined),
    // never the dwarf catalog values.
    const dwarf = (
      characterCatalog as Record<
        string,
        {
          baseMaxHp: number
          baseSpeed: number
          damageMultiplier: number
          fireRateMultiplier: number
        }
      >
    )['dwarf']!
    expect(player.maxHp).toBe(dwarf.baseMaxHp)
    expect(player.speed).toBe(dwarf.baseSpeed)
    expect(player.damageMultiplier).toBe(dwarf.damageMultiplier)
    expect(player.fireRateMultiplier).toBe(dwarf.fireRateMultiplier)

    await client.leave()
  })

  it('onJoin seeds weapons array with the selected starting weapon (CHAR-03)', async () => {
    const room = (await server.createRoom('solo_room', {})) as any

    server.sdk.auth.token = signTestGameToken()
    const client = await server.connectTo(room, { classId: 'human', weaponId: 'bible' })

    const player = room.plainState.players.get(client.sessionId)

    // RED: onJoin currently always seeds ['magic_wand:1'] regardless of options.
    expect(player.weapons.length).toBe(1)
    expect(player.weapons[0]).toContain('bible')

    await client.leave()
  })

  it('onJoin with invalid classId defaults to human (Zod validation, CHAR-01)', async () => {
    const room = (await server.createRoom('solo_room', {})) as any

    server.sdk.auth.token = signTestGameToken()
    // 'elf' is not a valid classId — CharacterSelectSchema.safeParse should
    // reject it and the server should default to 'human'.
    const client = await server.connectTo(room, { classId: 'elf', weaponId: 'magic_wand' })

    const player = room.plainState.players.get(client.sessionId)

    // RED: human is the multiplier baseline (1.0/1.0, characterCatalog.test.ts
    // asserts this once the real catalog lands). onJoin never sets these
    // fields today, so they are undefined — fails against the literal 1.0.
    const human = (characterCatalog as Record<string, { baseMaxHp: number }>)['human']!
    expect(player.maxHp).toBe(human.baseMaxHp)
    expect(player.damageMultiplier).toBe(1.0)
    expect(player.fireRateMultiplier).toBe(1.0)

    await client.leave()
  })

  it('onJoin with invalid weaponId defaults to magic_wand (Zod validation, CHAR-03)', async () => {
    const room = (await server.createRoom('solo_room', {})) as any

    server.sdk.auth.token = signTestGameToken()
    // 'shotgun' is not a valid weaponId — should default to 'magic_wand'.
    const client = await server.connectTo(room, { classId: 'human', weaponId: 'shotgun' })

    const player = room.plainState.players.get(client.sessionId)

    expect(player.weapons[0]).toContain('magic_wand')
    // RED: damageMultiplier/fireRateMultiplier are not seeded from the human
    // baseline today (undefined), so this fails until 05-08 wires catalog seeding.
    expect(player.damageMultiplier).toBe(1.0)
    expect(player.fireRateMultiplier).toBe(1.0)

    await client.leave()
  })

  it('onJoin with no options at all defaults to human/magic_wand', async () => {
    const room = (await server.createRoom('solo_room', {})) as any

    server.sdk.auth.token = signTestGameToken()
    const client = await server.connectTo(room, {})

    const player = room.plainState.players.get(client.sessionId)

    expect(player.weapons[0]).toContain('magic_wand')
    // RED: same as above — catalog-seeded baseline multipliers are not yet
    // applied by onJoin.
    expect(player.damageMultiplier).toBe(1.0)
    expect(player.fireRateMultiplier).toBe(1.0)

    await client.leave()
  })
})
