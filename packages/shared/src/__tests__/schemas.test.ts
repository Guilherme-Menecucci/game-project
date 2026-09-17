/**
 * PlayerInputSchema hardening tests (security: non-finite input).
 *
 * Bare z.number() rejects NaN but ACCEPTS Infinity. An Infinity moveVector
 * component flows into simulateTick's normalization (vx = dx*speed/mag) and
 * produces NaN, which permanently corrupts the player's integer position.
 * Colyseus messages travel over msgpack, which preserves non-finite floats,
 * so a malicious client can reach this path. The schema must reject it.
 */
import { describe, it, expect } from 'vitest'
import {
  PlayerInputSchema,
  simulateTick,
  makeInitialState,
  mulberry32,
  ReadySchema,
  StartRunSchema,
  VotePauseSchema,
  VoteResumeSchema,
  CoopCreateOptionsSchema,
  CoopJoinOptionsSchema,
  CharacterSelectSchema,
} from '@game/shared'

describe('PlayerInputSchema rejects non-finite values', () => {
  const base = { moveVector: { x: 0, y: 0 }, aimAngle: 0, actionFlags: 0, seq: 0, tick: 0 }

  it('rejects Infinity in moveVector.x', () => {
    expect(
      PlayerInputSchema.safeParse({ ...base, moveVector: { x: Infinity, y: 0 } }).success
    ).toBe(false)
  })

  it('rejects -Infinity in moveVector.y', () => {
    expect(
      PlayerInputSchema.safeParse({ ...base, moveVector: { x: 0, y: -Infinity } }).success
    ).toBe(false)
  })

  it('rejects NaN in moveVector', () => {
    expect(PlayerInputSchema.safeParse({ ...base, moveVector: { x: NaN, y: 0 } }).success).toBe(
      false
    )
  })

  it('rejects Infinity aimAngle', () => {
    expect(PlayerInputSchema.safeParse({ ...base, aimAngle: Infinity }).success).toBe(false)
  })

  it('still accepts ordinary finite input', () => {
    expect(PlayerInputSchema.safeParse({ ...base, moveVector: { x: 0.7, y: -0.3 } }).success).toBe(
      true
    )
  })
})

describe('PlayerInputSchema seq requirement (Phase 6 Wave 0 anti-replay)', () => {
  const base = { moveVector: { x: 0, y: 0 }, aimAngle: 0, actionFlags: 0 }

  it('rejects payloads with no seq field', () => {
    // seq is required as of Phase 6 Wave 0 — anti-replay depends on every
    // input frame carrying a monotone sequence number.
    expect(PlayerInputSchema.safeParse({ ...base, tick: 0 }).success).toBe(false)
  })

  it('accepts seq: 0 (fresh connection starts at zero)', () => {
    expect(PlayerInputSchema.safeParse({ ...base, seq: 0, tick: 0 }).success).toBe(true)
  })

  it('rejects negative seq', () => {
    expect(PlayerInputSchema.safeParse({ ...base, seq: -1, tick: 0 }).success).toBe(false)
  })

  it('rejects fractional seq', () => {
    expect(PlayerInputSchema.safeParse({ ...base, seq: 1.5, tick: 0 }).success).toBe(false)
  })

  it('tick stays optional', () => {
    expect(PlayerInputSchema.safeParse({ ...base, seq: 0 }).success).toBe(true)
  })
})

describe('simulateTick is immune to non-finite moveVector', () => {
  it('keeps player position finite when fed an Infinity move vector', () => {
    const state = makeInitialState(1)
    const [playerId] = [...state.players.keys()]
    const player = state.players.get(playerId)!
    const startX = player.x
    const startY = player.y

    // Bypass TypeScript to mimic a malicious raw message reaching the sim.
    const malicious = {
      moveVector: { x: Infinity, y: Infinity },
      aimAngle: 0,
      actionFlags: 0,
    } as never
    const inputs = new Map([[playerId, malicious]])

    const next = simulateTick(state, inputs, mulberry32(1))
    const np = next.players.get(playerId)!

    expect(Number.isFinite(np.x)).toBe(true)
    expect(Number.isFinite(np.y)).toBe(true)
    // Non-finite input is dropped → no movement applied
    expect(np.x).toBe(startX)
    expect(np.y).toBe(startY)
  })
})

// ─── Phase 6 co-op message schemas (ROOM-01/04/11, T-06-09) ──────────────────
//
// Every new CoopRoom message crosses the client → server trust boundary and is
// gated by safeParse + silent drop on the server. These tests pin the wire
// contract consumed by 06-08 (CoopRoom handlers) and 06-11 (client screens).

/** Payload shapes that must never validate as an object message. */
const JUNK_PAYLOADS: ReadonlyArray<[label: string, value: unknown]> = [
  ['undefined', undefined],
  ['null', null],
  ['array', []],
  ['string', 'ready'],
  ['number', 1],
  ['boolean', true],
]

describe('ReadySchema (lobby ready flag)', () => {
  it('accepts { ready: true }', () => {
    expect(ReadySchema.safeParse({ ready: true }).success).toBe(true)
  })

  it('accepts { ready: false }', () => {
    expect(ReadySchema.safeParse({ ready: false }).success).toBe(true)
  })

  it('rejects a missing ready field', () => {
    expect(ReadySchema.safeParse({}).success).toBe(false)
  })

  it('rejects non-boolean ready values', () => {
    expect(ReadySchema.safeParse({ ready: 'true' }).success).toBe(false)
    expect(ReadySchema.safeParse({ ready: 1 }).success).toBe(false)
    expect(ReadySchema.safeParse({ ready: null }).success).toBe(false)
  })

  it.each(JUNK_PAYLOADS)('rejects a %s payload', (_label, value) => {
    expect(ReadySchema.safeParse(value).success).toBe(false)
  })
})

describe.each([
  ['StartRunSchema', StartRunSchema],
  ['VotePauseSchema', VotePauseSchema],
  ['VoteResumeSchema', VoteResumeSchema],
] as const)('%s (no-data message)', (_name, schema) => {
  it('accepts an empty object payload', () => {
    expect(schema.safeParse({}).success).toBe(true)
  })

  it.each(JUNK_PAYLOADS)('rejects a %s payload', (_label, value) => {
    // Note: undefined is rejected too — clients MUST send `{}` (Colyseus
    // room.send(type) with no message delivers undefined to the handler).
    expect(schema.safeParse(value).success).toBe(false)
  })
})

describe('CoopCreateOptionsSchema (create-room join options)', () => {
  it('accepts { token } with isPrivate omitted', () => {
    expect(CoopCreateOptionsSchema.safeParse({ token: 'jwt.here.x' }).success).toBe(true)
  })

  it('accepts { token, isPrivate: true } and { token, isPrivate: false }', () => {
    expect(CoopCreateOptionsSchema.safeParse({ token: 'jwt', isPrivate: true }).success).toBe(true)
    expect(CoopCreateOptionsSchema.safeParse({ token: 'jwt', isPrivate: false }).success).toBe(true)
  })

  it('rejects a missing token', () => {
    expect(CoopCreateOptionsSchema.safeParse({ isPrivate: true }).success).toBe(false)
    expect(CoopCreateOptionsSchema.safeParse({}).success).toBe(false)
  })

  it('rejects an empty-string or non-string token', () => {
    expect(CoopCreateOptionsSchema.safeParse({ token: '' }).success).toBe(false)
    expect(CoopCreateOptionsSchema.safeParse({ token: 123 }).success).toBe(false)
  })

  it('rejects a non-boolean isPrivate', () => {
    expect(CoopCreateOptionsSchema.safeParse({ token: 'jwt', isPrivate: 'yes' }).success).toBe(
      false
    )
  })

  it.each(JUNK_PAYLOADS)('rejects a %s payload', (_label, value) => {
    expect(CoopCreateOptionsSchema.safeParse(value).success).toBe(false)
  })
})

describe('CoopJoinOptionsSchema (join-room options)', () => {
  it('accepts { token }', () => {
    expect(CoopJoinOptionsSchema.safeParse({ token: 'jwt.here.x' }).success).toBe(true)
  })

  it('rejects a missing token', () => {
    expect(CoopJoinOptionsSchema.safeParse({}).success).toBe(false)
  })

  it('rejects an empty-string or non-string token', () => {
    expect(CoopJoinOptionsSchema.safeParse({ token: '' }).success).toBe(false)
    expect(CoopJoinOptionsSchema.safeParse({ token: null }).success).toBe(false)
  })

  it.each(JUNK_PAYLOADS)('rejects a %s payload', (_label, value) => {
    expect(CoopJoinOptionsSchema.safeParse(value).success).toBe(false)
  })
})

describe('select_class reuses CharacterSelectSchema unchanged', () => {
  it('is exported and still validates the Phase 5 loadout shape', () => {
    expect(CharacterSelectSchema).toBeDefined()
    expect(
      CharacterSelectSchema.safeParse({ classId: 'vampire', weaponId: 'garlic' }).success
    ).toBe(true)
    expect(
      CharacterSelectSchema.safeParse({ classId: 'human', weaponId: 'magic_wand' }).success
    ).toBe(true)
  })

  it('still rejects unknown class or weapon ids', () => {
    expect(CharacterSelectSchema.safeParse({ classId: 'elf', weaponId: 'garlic' }).success).toBe(
      false
    )
    expect(CharacterSelectSchema.safeParse({ classId: 'human', weaponId: 'laser' }).success).toBe(
      false
    )
  })
})
