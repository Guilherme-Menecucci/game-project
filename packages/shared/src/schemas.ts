/**
 * Game input and auth schemas — shared Zod validators.
 * Separated from index.ts so game simulation files can import
 * PlayerInputSchema without creating a circular dependency.
 */
import * as z from 'zod'

// Game input schemas (Phase 1)
export const PlayerInputSchema = z.object({
  // .finite() rejects NaN/±Infinity. Bare z.number() accepts Infinity, which
  // flows into simulateTick normalization (vx = dx*speed/mag) → NaN → permanent
  // NaN player position. msgpack preserves non-finite floats on the wire, so a
  // malicious client can reach this path; reject it at the schema boundary.
  moveVector: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  aimAngle: z.number().finite(),
  actionFlags: z.number().int(),
  // D-02: Anti-replay sequence number — monotone per client connection.
  // REQUIRED as of Phase 6 Wave 0 (T-06-01): the room's input handler drops
  // any frame whose seq is <= the last accepted seq for that session, so every
  // input must carry one. Client already sends it (GameScene sendSeq++).
  seq: z.number().int().min(0),
  // D-02: Server tick reference — ties input snapshot to the authoritative tick.
  // Optional in Phase 3 for backward compat; will be required in Phase 4.
  tick: z.number().int().min(0).optional(),
})

export type PlayerInput = z.infer<typeof PlayerInputSchema>

// Auth schemas (Phase 2)
export const LoginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
})
export type Login = z.infer<typeof LoginSchema>

export const RegisterSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(72),
})
export type Register = z.infer<typeof RegisterSchema>

export const GuestTokenResponseSchema = z.object({
  userId: z.uuid(),
  isGuest: z.literal(true),
  displayName: z.string(),
})
export type GuestTokenResponse = z.infer<typeof GuestTokenResponseSchema>

// Phase 4 Schemas
export const UpgradeSelectedSchema = z.object({
  upgradeId: z.string(),
})
export type UpgradeSelected = z.infer<typeof UpgradeSelectedSchema>

export const ReplaceSlotSchema = z.object({
  slot: z.number().int().min(0).max(5),
  upgradeId: z.string(),
})
export type ReplaceSlot = z.infer<typeof ReplaceSlotSchema>

// Phase 5 Schemas
// CHAR-01/02/03: validates the character_select onJoin option. Server
// defaults to classId:'human', weaponId:'magic_wand' on safeParse failure
// (enforced in a later wave's SoloRoom plan) — T-05-00 mitigation.
export const CharacterSelectSchema = z.object({
  classId: z.enum(['vampire', 'human', 'dwarf']),
  weaponId: z.enum(['magic_wand', 'garlic', 'knife', 'bible']),
})
export type CharacterSelect = z.infer<typeof CharacterSelectSchema>

// ─── Phase 6 Schemas ──────────────────────────────────────────────────────────
// Co-op room wire contracts (ROOM-01/04/11). Every CoopRoom message crosses
// the client → server trust boundary; the server validates each payload with
// safeParse and silently drops failures (T-06-09). These schemas are the
// single source of truth for both CoopRoom handlers (06-08) and the client
// lobby/HUD screens (06-11).
//
// Wire rule: no-data messages (start_run, vote_pause, vote_resume) MUST be
// sent as `room.send('start_run', {})`. z.object({}) rejects `undefined`, and
// Colyseus delivers `undefined` to the handler when the message argument is
// omitted — so a bare `room.send('start_run')` is silently dropped.
//
// select_class reuses CharacterSelectSchema above (same loadout shape as the
// Phase 5 character_select join option) — no new schema.

/** `ready` message: toggles the sender's lobby ready flag (ROOM-04). */
export const ReadySchema = z.object({
  ready: z.boolean(),
})
export type Ready = z.infer<typeof ReadySchema>

/**
 * `start_run` message: host asks the room to leave the lobby. Carries no
 * data — the server derives everything (host identity, ready state, seeds)
 * from its own state so nothing here can be tampered with.
 */
export const StartRunSchema = z.object({})
export type StartRun = z.infer<typeof StartRunSchema>

/** `vote_pause` message: sender casts a pause vote. No data (server-derived). */
export const VotePauseSchema = z.object({})
export type VotePause = z.infer<typeof VotePauseSchema>

/** `vote_resume` message: sender casts a resume vote. No data (server-derived). */
export const VoteResumeSchema = z.object({})
export type VoteResume = z.infer<typeof VoteResumeSchema>

/**
 * `create` join options for CoopRoom. `token` is the 5-minute game JWT
 * (verified in static onAuth — identity and displayName come from the token,
 * never from a client-sent name, T-06-08). `isPrivate` hides the room from
 * public matchmaking; omitted means public.
 */
export const CoopCreateOptionsSchema = z.object({
  token: z.string().min(1),
  isPrivate: z.boolean().optional(),
})
export type CoopCreateOptions = z.infer<typeof CoopCreateOptionsSchema>

/** `joinById` / `joinByCode` options for CoopRoom — game JWT only. */
export const CoopJoinOptionsSchema = z.object({
  token: z.string().min(1),
})
export type CoopJoinOptions = z.infer<typeof CoopJoinOptionsSchema>
