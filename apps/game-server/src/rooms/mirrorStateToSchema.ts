/**
 * mirrorStateToSchema — copies a PlainGameState into the Colyseus GameStateSchema.
 *
 * Extracted verbatim from SoloRoom.ts (06-05) so BaseGameRoom and every room
 * subclass share a single mirror implementation. Pure transform over the two
 * arguments; no room state, no side effects beyond mutating `schema` in place.
 */
import type { PlainGameState, PlainPlayerState } from '@game/shared'
import {
  GameStateSchema,
  PlayerSchema,
  EnemySchema,
  GemSchema,
  ProjectileSchema,
  PickupSchema,
  BossSchema,
  WeaponStatsSchema,
} from '../schema/GameSchema.js'

/** Co-op downed/revive/eliminated fields (06-09) with wire-width clamps. */
function mirrorCoopFields(ps: PlayerSchema, p: PlainPlayerState): void {
  ps.downed = p.downed ?? false
  ps.bleedOutRemainingMs = Math.max(0, Math.min(65535, Math.round(p.bleedOutRemainingMs ?? 0)))
  ps.reviveProgressTicks = Math.max(0, Math.min(255, Math.round(p.reviveProgressTicks ?? 0)))
  ps.eliminated = p.eliminated ?? false
}

/**
 * Mirror PlainGameState fields into the Colyseus GameStateSchema.
 *
 * CRITICAL: Always mutate existing Schema instances in-place.
 * Never replace MapSchema references — Colyseus delta encoder tracks the instance.
 * Replacing schema.players = new MapSchema() triggers full re-encode, not delta.
 */
export function mirrorStateToSchema(plain: PlainGameState, schema: GameStateSchema): void {
  schema.tick = plain.tick
  schema.elapsedMs = plain.elapsedMs
  schema.kills = plain.kills ?? 0
  schema.result = plain.result ?? ''

  // --- Players: mutate existing, add new, delete removed ---
  for (const [id, p] of plain.players) {
    if (schema.players.has(id)) {
      // Mutate existing instance in-place (delta encoding preserves only changed fields)
      const ps = schema.players.get(id)!
      ps.x = p.x
      ps.y = p.y
      // Clamp hp to >= 0 before assigning to uint8: simulateTick can produce
      // negative hp on overkill (e.g. -3), which wraps to 253 in uint8 — visually
      // un-killing the player on the client.
      ps.hp = Math.max(0, p.hp)
      ps.maxHp = p.maxHp
      ps.level = p.level
      ps.xp = p.xp
      ps.classId = p.classId ?? 'human'
      ps.damageMultiplier = Math.round((p.damageMultiplier ?? 1) * 100)
      ps.fireRateMultiplier = Math.round((p.fireRateMultiplier ?? 1) * 100)
      mirrorCoopFields(ps, p)

      // Sync weapons: splice to clear then push all
      while (ps.weapons.length > p.weapons.length) {
        ps.weapons.pop()
      }
      for (let i = 0; i < p.weapons.length; i++) {
        if (ps.weapons[i] !== p.weapons[i]) {
          ps.weapons[i] = p.weapons[i]!
        }
      }
      if (ps.weapons.length < p.weapons.length) {
        ps.weapons.push(...p.weapons.slice(ps.weapons.length))
      }

      // Sync passives: splice to clear then push all
      while (ps.passives.length > p.passives.length) {
        ps.passives.pop()
      }
      for (let i = 0; i < p.passives.length; i++) {
        if (ps.passives[i] !== p.passives[i]) {
          ps.passives[i] = p.passives[i]!
        }
      }
      if (ps.passives.length < p.passives.length) {
        ps.passives.push(...p.passives.slice(ps.passives.length))
      }

      // Sync weaponStats (D-21): get-or-create + mutate in-place (MUTATION RULE).
      // Never re-set an existing key with a new instance — delta encoder tracks instances.
      const plainWS = p.weaponStats ?? {}
      for (const [key, stats] of Object.entries(plainWS)) {
        let ws = ps.weaponStats.get(key)
        if (!ws) {
          ws = new WeaponStatsSchema()
          ps.weaponStats.set(key, ws)
        }
        ws.totalDamage = stats.totalDamage
        ws.acquiredAtMs = stats.acquiredAtMs
      }
      // Delete schema weaponStats entries not present in plain state
      for (const key of ps.weaponStats.keys()) {
        if (!(key in plainWS)) {
          ps.weaponStats.delete(key)
        }
      }
    } else {
      // Add new player
      const ps = new PlayerSchema()
      ps.id = id
      ps.x = p.x
      ps.y = p.y
      ps.hp = Math.max(0, p.hp)
      ps.maxHp = p.maxHp
      ps.level = p.level
      ps.xp = p.xp
      ps.classId = p.classId ?? 'human'
      ps.damageMultiplier = Math.round((p.damageMultiplier ?? 1) * 100)
      ps.fireRateMultiplier = Math.round((p.fireRateMultiplier ?? 1) * 100)
      mirrorCoopFields(ps, p)
      for (const w of p.weapons) {
        ps.weapons.push(w)
      }
      for (const pass of p.passives) {
        ps.passives.push(pass)
      }
      // Seed weaponStats entries for new player
      const plainWS = p.weaponStats ?? {}
      for (const [key, stats] of Object.entries(plainWS)) {
        const ws = new WeaponStatsSchema()
        ws.totalDamage = stats.totalDamage
        ws.acquiredAtMs = stats.acquiredAtMs
        ps.weaponStats.set(key, ws)
      }
      schema.players.set(id, ps)
    }
  }
  // Delete players not in plain state
  for (const id of schema.players.keys()) {
    if (!plain.players.has(id)) {
      schema.players.delete(id)
    }
  }

  // --- Enemies: mutate existing, add new, delete removed ---
  for (const [id, e] of plain.enemies) {
    if (schema.enemies.has(id)) {
      const es = schema.enemies.get(id)!
      es.x = e.x
      es.y = e.y
      es.hp = e.hp
      es.maxHp = e.maxHp
      es.archetype = e.archetype
      es.isElite = e.isElite ?? false
      es.eliteName = e.eliteName ?? ''
    } else {
      const es = new EnemySchema()
      es.id = id
      es.x = e.x
      es.y = e.y
      es.hp = e.hp
      es.maxHp = e.maxHp
      es.archetype = e.archetype
      es.isElite = e.isElite ?? false
      es.eliteName = e.eliteName ?? ''
      schema.enemies.set(id, es)
    }
  }
  for (const id of schema.enemies.keys()) {
    if (!plain.enemies.has(id)) {
      schema.enemies.delete(id)
    }
  }

  // --- Bosses: mutate existing, add new, delete removed ---
  for (const [id, b] of plain.bosses ?? []) {
    if (schema.bosses.has(id)) {
      const bs = schema.bosses.get(id)!
      bs.id = b.id
      bs.bossKey = b.bossKey
      bs.name = b.name
      bs.x = b.x
      bs.y = b.y
      bs.hp = b.hp
      bs.maxHp = b.maxHp
      bs.speed = b.speed
      bs.telegraphState = b.telegraphState ?? 'idle'
      bs.telegraphTick = b.telegraphTick ?? 0
    } else {
      const bs = new BossSchema()
      bs.id = b.id
      bs.bossKey = b.bossKey
      bs.name = b.name
      bs.x = b.x
      bs.y = b.y
      bs.hp = b.hp
      bs.maxHp = b.maxHp
      bs.speed = b.speed
      bs.telegraphState = b.telegraphState ?? 'idle'
      bs.telegraphTick = b.telegraphTick ?? 0
      schema.bosses.set(id, bs)
    }
  }
  for (const id of schema.bosses.keys()) {
    if (!(plain.bosses ?? new Map()).has(id)) {
      schema.bosses.delete(id)
    }
  }

  // --- Gems: mutate existing, add new, delete removed ---
  for (const [id, g] of plain.gems) {
    if (schema.gems.has(id)) {
      const gs = schema.gems.get(id)!
      gs.x = g.x
      gs.y = g.y
      gs.value = g.value
    } else {
      const gs = new GemSchema()
      gs.id = id
      gs.x = g.x
      gs.y = g.y
      gs.value = g.value
      schema.gems.set(id, gs)
    }
  }
  for (const id of schema.gems.keys()) {
    if (!plain.gems.has(id)) {
      schema.gems.delete(id)
    }
  }

  // --- Projectiles: mutate existing, add new, delete removed ---
  for (const [id, pr] of plain.projectiles) {
    if (schema.projectiles.has(id)) {
      const prs = schema.projectiles.get(id)!
      prs.x = pr.x
      prs.y = pr.y
      prs.isEnemy = pr.isEnemy
    } else {
      const prs = new ProjectileSchema()
      prs.id = id
      prs.x = pr.x
      prs.y = pr.y
      prs.isEnemy = pr.isEnemy
      schema.projectiles.set(id, prs)
    }
  }
  for (const id of schema.projectiles.keys()) {
    if (!plain.projectiles.has(id)) {
      schema.projectiles.delete(id)
    }
  }

  // --- Pickups: mutate existing, add new, delete removed ---
  for (const [id, pk] of plain.pickups) {
    if (schema.pickups.has(id)) {
      const pks = schema.pickups.get(id)!
      pks.x = pk.x
      pks.y = pk.y
      pks.kind = pk.kind
    } else {
      const pks = new PickupSchema()
      pks.id = id
      pks.x = pk.x
      pks.y = pk.y
      pks.kind = pk.kind
      schema.pickups.set(id, pks)
    }
  }
  for (const id of schema.pickups.keys()) {
    if (!plain.pickups.has(id)) {
      schema.pickups.delete(id)
    }
  }
}
