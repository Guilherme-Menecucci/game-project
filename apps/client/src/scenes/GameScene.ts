/**
 * GameScene — Phaser rendering loop driven by Colyseus state deltas.
 *
 * Uses room.onStateChange (20Hz) to reconcile sprites with server state.
 * This matches the HUD pattern and avoids Callbacks.get() timing issues
 * (onAdd does not fire for entities already present when the callback is registered).
 *
 * Coordinate conversion (D-06):
 *   Server stores sub-unit integers (e.g. 2,048,000 for world center).
 *   toGU(x) = x / 1000.
 *
 * Input (D-02):
 *   WASD + arrow keys. Normalized moveVector sent at 20Hz (INPUT_INTERVAL=50ms).
 *   aimAngle=0 (Phase 3 auto-aim). actionFlags=0.
 */
import Phaser from 'phaser'
import type { Room } from '@colyseus/sdk'

const toGU = (subUnits: number): number => subUnits / 1000

/** Map a player's classId (D-09) to the per-class atlas frame; falls back to the generic 'player' frame. */
const frameForClassId = (classId: string | undefined): string => {
  if (classId === 'vampire') return 'player_vampire'
  if (classId === 'human') return 'player_human'
  if (classId === 'dwarf') return 'player_dwarf'
  return 'player'
}

/** Map a boss's bossKey to the distinct atlas frame (D-18); falls back to boss_patient_zero. */
const frameForBossKey = (bossKey: string | undefined): string => {
  if (bossKey === 'unfinished_one') return 'boss_unfinished_one'
  return 'boss_patient_zero'
}

export class GameScene extends Phaser.Scene {
  private readonly INPUT_INTERVAL = 50

  private room!: Room
  private localPlayerId!: string

  private playerSprites = new Map<string, Phaser.GameObjects.Sprite>()
  private enemySprites = new Map<string, Phaser.GameObjects.Sprite>()
  private gemSprites = new Map<string, Phaser.GameObjects.Sprite>()
  private projectileSprites = new Map<string, Phaser.GameObjects.Sprite>()
  private bossSprites = new Map<string, Phaser.GameObjects.Sprite>()
  private pickupsGraphics!: Phaser.GameObjects.Graphics
  private auraGraphics!: Phaser.GameObjects.Graphics

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd!: {
    up: Phaser.Input.Keyboard.Key
    down: Phaser.Input.Keyboard.Key
    left: Phaser.Input.Keyboard.Key
    right: Phaser.Input.Keyboard.Key
  }

  private inputTimer = 0
  private sendSeq = 0
  private gameOverEmitted = false
  /** Track previous enemy keys to count kills via state diff */
  private prevEnemyKeys = new Set<string>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stateCallback?: (state: any) => void

  private lastWeapons: string[] = []
  private lastPassives: string[] = []
  private lastLevel = 1
  private lastXp = 0

  constructor() {
    super({ key: 'GameScene' })
  }

  create(data: { room: Room }): void {
    this.room = data.room
    this.localPlayerId = this.room.sessionId

    this.cameras.main.setBounds(0, 0, 4096, 4096)
    this.cameras.main.setBackgroundColor('#1e2030')

    this.game.registry.set('killCount', 0)

    this.pickupsGraphics = this.add.graphics()
    this.pickupsGraphics.setDepth(0.5)

    this.auraGraphics = this.add.graphics()
    this.auraGraphics.setDepth(1.5)

    this.cursors = this.input.keyboard!.createCursorKeys()
    this.wasd = {
      up: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    }

    // Use onStateChange for all rendering — fires immediately with current state
    // and on every subsequent server tick (20Hz). Avoids Callbacks.onAdd timing
    // issues where the player is already in state before the callback is registered.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.stateCallback = (state: any) => {
      this.syncState(state)
    }
    this.room.onStateChange(this.stateCallback)

    this.events.once('shutdown', () => {
      if (this.stateCallback) {
        this.room.onStateChange.remove(this.stateCallback)
        this.stateCallback = undefined
      }
    })

    // Room disconnect = game over (server shutdown, player kicked, etc.)
    this.room.onLeave(() => {
      if (!this.gameOverEmitted) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const state = this.room.state as any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const myPlayer = (state?.players as Map<string, any>)?.get(this.localPlayerId)
        this.emitGameOver(myPlayer)
      }
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private syncState(state: any): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const players = state.players as Map<string, any>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enemies = state.enemies as Map<string, any>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gems = state.gems as Map<string, any>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const projectiles = state.projectiles as Map<string, any>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bosses = state.bosses as Map<string, any>

    this.auraGraphics.clear()

    // --- Players ---
    for (const [key, player] of players) {
      if (key === this.localPlayerId) {
        if (player.weapons) {
          this.lastWeapons = Array.from(player.weapons)
        }
        if (player.passives) {
          this.lastPassives = Array.from(player.passives)
        }
        this.lastLevel = player.level ?? 1
        this.lastXp = player.xp ?? 0
      }

      if (!this.playerSprites.has(key)) {
        const frame = frameForClassId(player.classId as string | undefined)
        const sprite = this.add.sprite(toGU(player.x), toGU(player.y), 'entities', frame)
        sprite.setDepth(2)
        this.playerSprites.set(key, sprite)
        if (key === this.localPlayerId) {
          this.cameras.main.startFollow(sprite, true, 0.1, 0.1)
        }
      } else {
        const sprite = this.playerSprites.get(key)!
        sprite.setPosition(toGU(player.x), toGU(player.y))
      }

      let garlicItem: string | undefined
      if (player.weapons && typeof player.weapons.find === 'function') {
        garlicItem = player.weapons.find((w: string) => w.startsWith('garlic'))
      }
      if (garlicItem) {
        const levelStr = garlicItem.split(':')[1]
        const level = levelStr ? parseInt(levelStr, 10) : 1
        const garlicRadiusMults = [0.6, 0.8, 1.0, 1.2, 1.5]
        const lvlIdx = Math.max(1, Math.min(5, level)) - 1
        const rMult = garlicRadiusMults[lvlIdx]
        const radius = 60 * rMult

        this.auraGraphics.fillStyle(0x4ade80, 0.15)
        this.auraGraphics.fillCircle(toGU(player.x), toGU(player.y), radius)
        this.auraGraphics.lineStyle(1.5, 0x4ade80, 0.4)
        this.auraGraphics.strokeCircle(toGU(player.x), toGU(player.y), radius)
      }

      // Game-over: local player HP reaches 0
      if (key === this.localPlayerId && player.hp <= 0 && !this.gameOverEmitted) {
        this.emitGameOver(player)
      }
    }
    // Remove sprites for players who left
    for (const key of this.playerSprites.keys()) {
      if (!players.has(key)) {
        this.playerSprites.get(key)!.destroy()
        this.playerSprites.delete(key)
      }
    }

    // --- Enemies ---
    const currentEnemyKeys = new Set(enemies.keys())
    // Count kills: enemies present last tick but gone now
    let newKills = 0
    for (const key of this.prevEnemyKeys) {
      if (!currentEnemyKeys.has(key)) newKills++
    }
    if (newKills > 0) {
      const prev = (this.game.registry.get('killCount') as number) ?? 0
      this.game.registry.set('killCount', prev + newKills)
    }
    this.prevEnemyKeys = currentEnemyKeys

    for (const [key, enemy] of enemies) {
      if (!this.enemySprites.has(key)) {
        const frame = (enemy.archetype as string) ?? 'swarmer'
        const sprite = this.add.sprite(toGU(enemy.x), toGU(enemy.y), 'entities', frame)
        sprite.setDepth(1)
        this.enemySprites.set(key, sprite)
      } else {
        const sprite = this.enemySprites.get(key)!
        sprite.setPosition(toGU(enemy.x), toGU(enemy.y))
      }
    }
    for (const key of this.enemySprites.keys()) {
      if (!enemies.has(key)) {
        this.enemySprites.get(key)!.destroy()
        this.enemySprites.delete(key)
      }
    }

    // --- Bosses ---
    for (const [key, boss] of bosses) {
      if (!this.bossSprites.has(key)) {
        const frame = frameForBossKey(boss.bossKey as string | undefined)
        const sprite = this.add.sprite(toGU(boss.x), toGU(boss.y), 'entities', frame)
        sprite.setDepth(2.5)
        this.bossSprites.set(key, sprite)
      } else {
        const sprite = this.bossSprites.get(key)!
        sprite.setPosition(toGU(boss.x), toGU(boss.y))
      }
    }
    for (const key of this.bossSprites.keys()) {
      if (!bosses.has(key)) {
        this.bossSprites.get(key)!.destroy()
        this.bossSprites.delete(key)
      }
    }

    // --- Gems ---
    for (const [key, gem] of gems) {
      if (!this.gemSprites.has(key)) {
        const sprite = this.add.sprite(toGU(gem.x), toGU(gem.y), 'entities', 'gem')
        sprite.setDepth(0)
        this.gemSprites.set(key, sprite)
      } else {
        this.gemSprites.get(key)!.setPosition(toGU(gem.x), toGU(gem.y))
      }
    }
    for (const key of this.gemSprites.keys()) {
      if (!gems.has(key)) {
        this.gemSprites.get(key)!.destroy()
        this.gemSprites.delete(key)
      }
    }

    // --- Projectiles ---
    for (const [key, proj] of projectiles) {
      if (!this.projectileSprites.has(key)) {
        let frame = 'proj_player'
        if (proj.isEnemy) {
          frame = 'proj_enemy'
        } else {
          if (key.includes('magic_wand')) {
            frame = 'proj_magic_wand'
          } else if (key.includes('holy_wand')) {
            frame = 'proj_holy_wand'
          } else if (key.includes('knife')) {
            frame = 'proj_knife'
          } else if (key.includes('thousand_edge')) {
            frame = 'proj_thousand_edge'
          } else if (key.startsWith('bible')) {
            frame = 'proj_bible'
          }
        }
        const sprite = this.add.sprite(toGU(proj.x), toGU(proj.y), 'entities', frame)
        sprite.setDepth(3)
        this.projectileSprites.set(key, sprite)
      } else {
        this.projectileSprites.get(key)!.setPosition(toGU(proj.x), toGU(proj.y))
      }
    }
    for (const key of this.projectileSprites.keys()) {
      if (!projectiles.has(key)) {
        this.projectileSprites.get(key)!.destroy()
        this.projectileSprites.delete(key)
      }
    }

    // --- Pickups ---
    this.pickupsGraphics.clear()
    interface PickupData {
      x: number
      y: number
      kind: 'health_orb' | 'xp_magnet' | 'screen_bomb'
    }
    const pickups = (state.pickups as Map<string, PickupData>) || new Map()
    for (const pickup of pickups.values()) {
      const screenX = toGU(pickup.x)
      const screenY = toGU(pickup.y)
      if (pickup.kind === 'health_orb') {
        this.pickupsGraphics.fillStyle(0x4ade80, 1)
        this.pickupsGraphics.fillCircle(screenX, screenY, 8)
      } else if (pickup.kind === 'xp_magnet') {
        this.pickupsGraphics.fillStyle(0x60a5fa, 1)
        this.pickupsGraphics.beginPath()
        this.pickupsGraphics.moveTo(screenX, screenY - 10)
        this.pickupsGraphics.lineTo(screenX + 8, screenY)
        this.pickupsGraphics.lineTo(screenX, screenY + 10)
        this.pickupsGraphics.lineTo(screenX - 8, screenY)
        this.pickupsGraphics.closePath()
        this.pickupsGraphics.fillPath()
      } else if (pickup.kind === 'screen_bomb') {
        this.pickupsGraphics.fillStyle(0xfb923c, 1)
        this.pickupsGraphics.beginPath()
        this.pickupsGraphics.moveTo(screenX, screenY - 12)
        this.pickupsGraphics.lineTo(screenX + 3, screenY - 3)
        this.pickupsGraphics.lineTo(screenX + 12, screenY)
        this.pickupsGraphics.lineTo(screenX + 3, screenY + 3)
        this.pickupsGraphics.lineTo(screenX, screenY + 12)
        this.pickupsGraphics.lineTo(screenX - 3, screenY + 3)
        this.pickupsGraphics.lineTo(screenX - 12, screenY)
        this.pickupsGraphics.lineTo(screenX - 3, screenY - 3)
        this.pickupsGraphics.closePath()
        this.pickupsGraphics.fillPath()
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private emitGameOver(player: any): void {
    this.gameOverEmitted = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = this.room.state as any

    const weapons = player?.weapons ? Array.from(player.weapons) : this.lastWeapons
    const passives = player?.passives ? Array.from(player.passives) : this.lastPassives
    const level = (player?.level as number) ?? this.lastLevel
    const xp = (player?.xp as number) ?? this.lastXp
    const result = (state?.result as string) ?? ''

    const weaponStatsRaw = player?.weaponStats
    const weaponStats: Record<string, { totalDamage: number; acquiredAtMs: number }> = {}
    if (weaponStatsRaw) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const [slot, stats] of weaponStatsRaw as Map<string, any>) {
        weaponStats[slot] = {
          totalDamage: stats.totalDamage ?? 0,
          acquiredAtMs: stats.acquiredAtMs ?? 0,
        }
      }
    }

    this.game.events.emit('gameover', {
      killCount: (this.game.registry.get('killCount') as number) ?? 0,
      elapsedMs: (state?.elapsedMs as number) ?? 0,
      level,
      xp,
      weapons,
      passives,
      result,
      weaponStats,
    })
    // Leave room so server stops ticking this client's player
    void this.room.leave()
  }

  update(_time: number, delta: number): void {
    let mx = 0
    let my = 0

    if (this.cursors.left.isDown || this.wasd.left.isDown) mx -= 1
    if (this.cursors.right.isDown || this.wasd.right.isDown) mx += 1
    if (this.cursors.up.isDown || this.wasd.up.isDown) my -= 1
    if (this.cursors.down.isDown || this.wasd.down.isDown) my += 1

    if (mx !== 0 && my !== 0) {
      mx *= 0.7071
      my *= 0.7071
    }

    this.inputTimer += delta
    if (this.inputTimer >= this.INPUT_INTERVAL) {
      this.room.send('input', {
        moveVector: { x: mx, y: my },
        aimAngle: 0,
        actionFlags: 0,
        seq: this.sendSeq++,
        tick: 0,
      })
      this.inputTimer = 0
    }
  }
}
