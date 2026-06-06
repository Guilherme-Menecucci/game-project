/**
 * Colyseus Schema classes for game state delta serialization.
 *
 * COORDINATE SYSTEM: All x/y use uint32 (not uint16).
 * - World = 4,096 game units × 1,000 sub-units = 4,096,000 sub-units
 * - uint16 max = 65,535 — INSUFFICIENT (would overflow at 65 game units)
 * - uint32 max = 4,294,967,295 — sufficient for full toroidal world
 *
 * MUTATION RULE: Always mutate Schema fields in-place on existing instances.
 * Never replace schema.players / schema.enemies / schema.gems MapSchema
 * references — Colyseus delta encoder tracks the MapSchema instance.
 * Replacing the object triggers full re-encode, breaking delta compression.
 */
import { Schema, type, MapSchema } from '@colyseus/schema'

export class PlayerSchema extends Schema {
  @type('string') declare id: string
  @type('uint32') declare x: number // sub-unit coordinate (0..4,095,999)
  @type('uint32') declare y: number
  @type('uint8') declare hp: number // max 255 — player max HP fits
  @type('uint8') declare maxHp: number
  @type('uint8') declare level: number // max 255 — level cap fits
  @type('uint8') declare xp: number // xp within current level (resets at threshold)
}

export class EnemySchema extends Schema {
  @type('string') declare id: string
  @type('uint32') declare x: number
  @type('uint32') declare y: number
  @type('uint8') declare hp: number
  @type('string') declare archetype: string // 'swarmer' | 'tank' | 'ranged'
}

export class GemSchema extends Schema {
  @type('string') declare id: string
  @type('uint32') declare x: number
  @type('uint32') declare y: number
  @type('uint8') declare value: number
}

export class GameStateSchema extends Schema {
  @type({ map: PlayerSchema }) declare players: MapSchema<PlayerSchema>
  @type({ map: EnemySchema }) declare enemies: MapSchema<EnemySchema>
  @type({ map: GemSchema }) declare gems: MapSchema<GemSchema>
  @type('uint32') declare tick: number
  @type('uint32') declare elapsedMs: number

  constructor() {
    super()
    this.players = new MapSchema<PlayerSchema>()
    this.enemies = new MapSchema<EnemySchema>()
    this.gems = new MapSchema<GemSchema>()
    this.tick = 0
    this.elapsedMs = 0
  }
}
