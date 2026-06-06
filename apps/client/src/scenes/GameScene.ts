/**
 * GameScene — Phaser rendering loop driven by Colyseus state deltas.
 *
 * Receives room from scene data (passed by BootScene after registry lookup).
 * Uses @colyseus/schema 4.x Callbacks.get(room) API for state listeners.
 * (room.state.*.onAdd is the @colyseus/schema 2.x API — removed in 4.x)
 *
 * Coordinate conversion (D-06):
 *   Server stores sub-unit integers (e.g. 2,048,000 for world center).
 *   Phaser expects game units. toGU(x) = x / 1000.
 *   Without this, all entities render at positions 1000x off-screen.
 *
 * Input (D-02):
 *   WASD + arrow keys captured. Normalized moveVector sent at 20Hz (INPUT_INTERVAL=50ms).
 *   aimAngle=0 (Phase 3 — auto-aim handled server-side). actionFlags=0.
 *   Monotonically incrementing sendSeq per D-02 anti-replay.
 *
 * Game-over detection:
 *   When local player hp <= 0 OR room.onLeave fires, emit 'gameover' on game.events.
 *   PhaserGame.tsx listens for this and calls the React onGameOver callback.
 *
 * GAME-05 — Enemy projectile rendering:
 *   Projectile sprites branch on isEnemy: proj_enemy frame for ranged enemy projectiles,
 *   proj_player frame for auto-fired player projectiles.
 */
import Phaser from 'phaser'
import { Callbacks } from '@colyseus/sdk'
import type { Room } from '@colyseus/sdk'

/** Convert sub-units to game units (Phaser pixel space). D-06 */
const toGU = (subUnits: number): number => subUnits / 1000

export class GameScene extends Phaser.Scene {
  /** 50ms = 20Hz input send rate (D-02) */
  private readonly INPUT_INTERVAL = 50

  private room!: Room
  private localPlayerId!: string

  /** Sprite maps keyed by entity id */
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

  /** Accumulated ms since last input dispatch */
  private inputTimer = 0
  /** Monotonically incrementing sequence number for input messages (D-02) */
  private sendSeq = 0

  constructor() {
    super({ key: 'GameScene' })
  }

  create(data: { room: Room }): void {
    this.room = data.room
    this.localPlayerId = this.room.sessionId

    // World size: 4096 x 4096 game units (4,096,000 sub-units / 1000)
    this.physics.world.setBounds(0, 0, 4096, 4096)
    this.cameras.main.setBounds(0, 0, 4096, 4096)
    this.cameras.main.setBackgroundColor('#1e2030')

    // Initialise kill counter in registry (PhaserGame.tsx also sets this to 0 after creation)
    this.game.registry.set('killCount', 0)

    // Keyboard input setup
    this.cursors = this.input.keyboard!.createCursorKeys()
    this.wasd = {
      up: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    }

    // -------------------------------------------------------------------
    // Register Colyseus state callbacks using @colyseus/schema 4.x API.
    //
    // Callbacks.get() returns a StateCallbackStrategy. The state type flows
    // from the Room generic. Room from @colyseus/sdk is Room<any> at the call
    // site (GamePage joinOrCreate returns untyped Room), so we use 'as any'
    // to unlock the typed callback methods without explicit schema imports.
    //
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = Callbacks.get(this.room as any) as any

    // --- Players ---
    cb.onAdd(
      'players',
      (player: { x: number; y: number; hp: number; level: number; xp: number }, key: string) => {
        const sprite = this.add.sprite(toGU(player.x), toGU(player.y), 'entities', 'player')
        sprite.setDepth(2)
        this.playerSprites.set(key, sprite)

        // Camera follows the local player
        if (key === this.localPlayerId) {
          this.cameras.main.startFollow(sprite, true, 0.1, 0.1)
        }

        // Game-over when local player hp drops to 0
        cb.listen(player, 'hp', (hp: number) => {
          if (key === this.localPlayerId && hp <= 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const state = this.room.state as any
            this.game.events.emit('gameover', {
              killCount: this.game.registry.get('killCount') ?? 0,
              elapsedMs: (state?.elapsedMs as number) ?? 0,
              level: player.level,
              xp: player.xp,
            })
          }
        })
      }
    )

    cb.onChange('players', (key: string, player: { x: number; y: number }) => {
      const sprite = this.playerSprites.get(key)
      if (sprite) {
        sprite.setPosition(toGU(player.x), toGU(player.y))
      }
    })

    cb.onRemove('players', (_player: unknown, key: string) => {
      const sprite = this.playerSprites.get(key)
      if (sprite) {
        sprite.destroy()
        this.playerSprites.delete(key)
      }
    })

    // --- Enemies ---
    cb.onAdd('enemies', (enemy: { x: number; y: number; archetype: string }, key: string) => {
      // Frame name matches archetype string: 'swarmer' | 'tank' | 'ranged' (matches atlas frames)
      const sprite = this.add.sprite(toGU(enemy.x), toGU(enemy.y), 'entities', enemy.archetype)
      sprite.setDepth(1)
      this.enemySprites.set(key, sprite)
    })

    cb.onChange('enemies', (key: string, enemy: { x: number; y: number }) => {
      const sprite = this.enemySprites.get(key)
      if (sprite) {
        sprite.setPosition(toGU(enemy.x), toGU(enemy.y))
      }
    })

    cb.onRemove('enemies', (_enemy: unknown, key: string) => {
      const sprite = this.enemySprites.get(key)
      if (sprite) {
        sprite.destroy()
        this.enemySprites.delete(key)
        // Increment kill counter
        const kills = (this.game.registry.get('killCount') as number) ?? 0
        this.game.registry.set('killCount', kills + 1)
      }
    })

    // --- Gems ---
    cb.onAdd('gems', (gem: { x: number; y: number }, key: string) => {
      const sprite = this.add.sprite(toGU(gem.x), toGU(gem.y), 'entities', 'gem')
      sprite.setDepth(0)
      this.gemSprites.set(key, sprite)
    })

    cb.onChange('gems', (key: string, gem: { x: number; y: number }) => {
      const sprite = this.gemSprites.get(key)
      if (sprite) {
        sprite.setPosition(toGU(gem.x), toGU(gem.y))
      }
    })

    cb.onRemove('gems', (_gem: unknown, key: string) => {
      const sprite = this.gemSprites.get(key)
      if (sprite) {
        sprite.destroy()
        this.gemSprites.delete(key)
      }
    })

    // --- Projectiles (GAME-05) ---
    cb.onAdd(
      'projectiles',
      (projectile: { x: number; y: number; isEnemy: boolean }, key: string) => {
        // Branch on isEnemy: enemy projectiles render orange-red, player projectiles render white
        const frame = projectile.isEnemy ? 'proj_enemy' : 'proj_player'
        const sprite = this.add.sprite(toGU(projectile.x), toGU(projectile.y), 'entities', frame)
        sprite.setDepth(3)
        this.projectileSprites.set(key, sprite)
      }
    )

    cb.onChange('projectiles', (key: string, projectile: { x: number; y: number }) => {
      const sprite = this.projectileSprites.get(key)
      if (sprite) {
        sprite.setPosition(toGU(projectile.x), toGU(projectile.y))
      }
    })

    cb.onRemove('projectiles', (_projectile: unknown, key: string) => {
      const sprite = this.projectileSprites.get(key)
      if (sprite) {
        sprite.destroy()
        this.projectileSprites.delete(key)
      }
    })

    // Game-over when room disconnects (server shutdown, player kicked, etc.)
    this.room.onLeave(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const state = this.room.state as any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const myPlayer = (state?.players as Map<string, any>)?.get(this.localPlayerId)
      this.game.events.emit('gameover', {
        killCount: this.game.registry.get('killCount') ?? 0,
        elapsedMs: (state?.elapsedMs as number) ?? 0,
        level: (myPlayer?.level as number) ?? 1,
        xp: (myPlayer?.xp as number) ?? 0,
      })
    })
  }

  update(_time: number, delta: number): void {
    // --- Capture keyboard input and compute normalized move vector ---
    let mx = 0
    let my = 0

    if (this.cursors.left.isDown || this.wasd.left.isDown) mx -= 1
    if (this.cursors.right.isDown || this.wasd.right.isDown) mx += 1
    if (this.cursors.up.isDown || this.wasd.up.isDown) my -= 1
    if (this.cursors.down.isDown || this.wasd.down.isDown) my += 1

    // Normalize diagonal movement to unit vector magnitude
    if (mx !== 0 && my !== 0) {
      mx *= 0.7071
      my *= 0.7071
    }

    // --- Accumulate time and send input at 20Hz (INPUT_INTERVAL = 50ms) ---
    this.inputTimer += delta
    if (this.inputTimer >= this.INPUT_INTERVAL) {
      this.room.send('input', {
        moveVector: { x: mx, y: my },
        aimAngle: 0, // Phase 3: auto-aim handled server-side
        actionFlags: 0,
        seq: this.sendSeq++,
        tick: 0,
      })
      this.inputTimer = 0
    }
  }
}
