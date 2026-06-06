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

export class GameScene extends Phaser.Scene {
  private readonly INPUT_INTERVAL = 50

  private room!: Room
  private localPlayerId!: string

  private playerSprites = new Map<string, Phaser.GameObjects.Sprite>()
  private enemySprites = new Map<string, Phaser.GameObjects.Sprite>()
  private gemSprites = new Map<string, Phaser.GameObjects.Sprite>()
  private projectileSprites = new Map<string, Phaser.GameObjects.Sprite>()

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

  constructor() {
    super({ key: 'GameScene' })
  }

  create(data: { room: Room }): void {
    this.room = data.room
    this.localPlayerId = this.room.sessionId

    this.physics.world.setBounds(0, 0, 4096, 4096)
    this.cameras.main.setBounds(0, 0, 4096, 4096)
    this.cameras.main.setBackgroundColor('#1e2030')

    this.game.registry.set('killCount', 0)

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
    this.room.onStateChange((state: any) => {
      this.syncState(state)
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

    // --- Players ---
    for (const [key, player] of players) {
      if (!this.playerSprites.has(key)) {
        const sprite = this.add.sprite(toGU(player.x), toGU(player.y), 'entities', 'player')
        sprite.setDepth(2)
        this.playerSprites.set(key, sprite)
        if (key === this.localPlayerId) {
          this.cameras.main.startFollow(sprite, true, 0.1, 0.1)
        }
      } else {
        const sprite = this.playerSprites.get(key)!
        sprite.setPosition(toGU(player.x), toGU(player.y))
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
        const frame = (proj.isEnemy as boolean) ? 'proj_enemy' : 'proj_player'
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
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private emitGameOver(player: any): void {
    this.gameOverEmitted = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = this.room.state as any
    this.game.events.emit('gameover', {
      killCount: (this.game.registry.get('killCount') as number) ?? 0,
      elapsedMs: (state?.elapsedMs as number) ?? 0,
      level: (player?.level as number) ?? 1,
      xp: (player?.xp as number) ?? 0,
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
