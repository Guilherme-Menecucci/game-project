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
 *
 * ENEMY HP WIDTH (Phase 5): EnemySchema.hp/maxHp remain `uint8`. The
 * eliteCatalog (packages/shared/src/eliteCatalog.ts) max hp value is 16
 * (elite4 "Brain Jar Crawler"), well under the uint8 ceiling of 255 — no
 * widening needed for elites. `maxHp` was previously absent entirely
 * (pre-existing gap); it is added here as `uint8` to match `hp` and support
 * HP-bar rendering for elites.
 *
 * BOSS HP WIDTH (Phase 5): BossSchema.hp/maxHp use `uint32` (not uint8/16).
 * bossCatalog baseHp values are 3000 (patient_zero) and 8000 (unfinished_one)
 * — both exceed uint8 (255). `scaleFinalBossStats` at metaProgressionLevel=0
 * scales unfinished_one to 8000 * 10 = 80,000, which exceeds uint16's 65,535
 * ceiling — uint32 is required, matching the x/y coordinate convention.
 */
import { Schema, type, MapSchema, ArraySchema } from '@colyseus/schema'

export class WeaponStatsSchema extends Schema {
  @type('uint32') declare totalDamage: number
  @type('uint32') declare acquiredAtMs: number
}

export class PlayerSchema extends Schema {
  @type('string') declare id: string
  @type('uint32') declare x: number // sub-unit coordinate (0..4,095,999)
  @type('uint32') declare y: number
  @type('uint8') declare hp: number // max 255 — player max HP fits
  @type('uint8') declare maxHp: number
  @type('uint32') declare level: number
  @type('uint32') declare xp: number
  @type(['string']) weapons = new ArraySchema<string>()
  @type(['string']) passives = new ArraySchema<string>()
  @type('string') declare classId: string // 'vampire' | 'human' | 'dwarf', default ''
  @type('uint16') declare damageMultiplier: number // scaled x100 (1.2 -> 120); client divides by 100
  @type('uint16') declare fireRateMultiplier: number // scaled x100 (0.9 -> 90); client divides by 100
  @type({ map: WeaponStatsSchema }) weaponStats = new MapSchema<WeaponStatsSchema>() // keyed by slot index '0'-'5' (D-21)
}

export class EnemySchema extends Schema {
  @type('string') declare id: string
  @type('uint32') declare x: number
  @type('uint32') declare y: number
  @type('uint8') declare hp: number
  @type('uint8') declare maxHp: number
  @type('string') declare archetype: string // 'swarmer' | 'tank' | 'ranged'
  @type('boolean') declare isElite: boolean // default false (D-25)
  @type('string') declare eliteName: string // display name when isElite, default ''
}

export class GemSchema extends Schema {
  @type('string') declare id: string
  @type('uint32') declare x: number
  @type('uint32') declare y: number
  @type('uint8') declare value: number
}

export class ProjectileSchema extends Schema {
  @type('string') declare id: string
  @type('uint32') declare x: number // sub-unit coordinate (0..4,095,999)
  @type('uint32') declare y: number
  @type('boolean') declare isEnemy: boolean // true = ranged enemy projectile (GAME-05)
}

export class PickupSchema extends Schema {
  @type('string') declare id: string
  @type('uint32') declare x: number
  @type('uint32') declare y: number
  @type('string') declare kind: string // 'health_orb' | 'xp_magnet' | 'screen_bomb'
}

export class BossSchema extends Schema {
  @type('string') declare id: string
  @type('string') declare bossKey: string // 'patient_zero' | 'unfinished_one'
  @type('string') declare name: string // display name
  @type('uint32') declare x: number
  @type('uint32') declare y: number
  @type('uint32') declare hp: number // uint32 — bossCatalog baseHp up to 8000, scaled up to 80,000
  @type('uint32') declare maxHp: number
  @type('uint16') declare speed: number
  @type('string') declare telegraphState: string // 'idle' | 'telegraphing' | 'attacking'
  @type('uint8') declare telegraphTick: number // range 0-99, fits uint8
}

export class GameStateSchema extends Schema {
  @type({ map: PlayerSchema }) declare players: MapSchema<PlayerSchema>
  @type({ map: EnemySchema }) declare enemies: MapSchema<EnemySchema>
  @type({ map: GemSchema }) declare gems: MapSchema<GemSchema>
  @type({ map: ProjectileSchema }) declare projectiles: MapSchema<ProjectileSchema>
  @type({ map: PickupSchema }) declare pickups: MapSchema<PickupSchema>
  @type({ map: BossSchema }) declare bosses: MapSchema<BossSchema>
  @type('uint32') declare tick: number
  @type('uint32') declare elapsedMs: number
  @type('uint32') declare kills: number
  @type('string') declare result: string // '' | 'survived' | 'defeated'

  constructor() {
    super()
    this.players = new MapSchema<PlayerSchema>()
    this.enemies = new MapSchema<EnemySchema>()
    this.gems = new MapSchema<GemSchema>()
    this.projectiles = new MapSchema<ProjectileSchema>()
    this.pickups = new MapSchema<PickupSchema>()
    this.bosses = new MapSchema<BossSchema>()
    this.tick = 0
    this.elapsedMs = 0
    this.kills = 0
    this.result = ''
  }
}
