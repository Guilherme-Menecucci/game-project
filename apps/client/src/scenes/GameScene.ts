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
 *   While the registry 'inputLocked' flag is true (pick/slot-full modal, 06-11)
 *   the send continues with a ZERO moveVector — never skipped, so no stale
 *   non-zero vector can keep applying server-side.
 *
 * Co-op (Phase 6, 06-12):
 *   Mode is latched from the wire: state.lobby is non-empty ONLY in co-op (solo
 *   never writes it; co-op keeps the local player's own entry for as long as
 *   they are in the room). players.size is NOT used — a mid-run leave deletes
 *   the leaver's schema player, so it can drop back to 1 inside a co-op run.
 *   - Camera follows the toroidal-aware squad centroid (computeCameraTarget)
 *     with a manually lerped zoom (computeZoom, clamped 0.5..1.0).
 *   - Downed players: amber tint @60% alpha + revive ring while being revived.
 *   - Eliminated players: sprite hidden; an eliminated local player spectates
 *     via the same centroid camera anchored on the first living teammate.
 *   - Gameover: hp <= 0 is NOT game over (downed/eliminated); the run ends for
 *     this client on state.result === 'defeated' (full-squad defeat) or via the
 *     existing onLeave path (End Run / connection loss).
 *   - Full-squad defeat does NOT leave the room (06-15): the room survives and
 *     reopens as a lobby, so the same Room instance hosts the next run with a
 *     NEW Phaser game. Every room listener this scene adds is therefore removed
 *     on shutdown AND destroy (PhaserGame unmounts via game.destroy(true), which
 *     only emits DESTROY) — a run-1 closure must never fire into run 2.
 */
import Phaser from 'phaser'
import type { Room } from '@colyseus/sdk'
import { computeCameraTarget, computeZoom, REVIVE_TICKS, WORLD_W } from '@game/shared'

const toGU = (subUnits: number): number => subUnits / 1000

/** UI-SPEC §7 in-world tokens (Phaser procedural, not CSS). */
const DOWNED_TINT = 0xe08a3c
const DOWNED_ALPHA = 0.6
const REVIVE_RING_COLOR = 0x4ade80
const REVIVE_RING_TRACK_COLOR = 0xffffff
const REVIVE_RING_TRACK_ALPHA = 0.15
const REVIVE_RING_RADIUS = 24 // game units
const REVIVE_RING_WIDTH = 4
/** Per-frame zoom lerp factor (manual lerp — zoomTo tweens per tick fight each other). */
const ZOOM_LERP = 0.08

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
  private leaveCallback?: () => void

  private lastWeapons: string[] = []
  private lastPassives: string[] = []
  private lastLevel = 1
  private lastXp = 0

  // --- Co-op (06-12) ---
  /** Latched true on the first sync where state.lobby is non-empty (co-op only). */
  private isCoop = false
  /** Camera follow switched from the local sprite to cameraTarget (once). */
  private followSwitched = false
  /** Centroid follow target in game units (plain object — Phaser follows any {x,y}). */
  private cameraTarget = { x: 0, y: 0 }
  private targetZoom = 1
  /** One lazily-created revive ring per downed-and-being-revived player. */
  private reviveRings = new Map<string, Phaser.GameObjects.Graphics>()

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

    // Room disconnect = game over (server shutdown, player kicked, etc.)
    this.leaveCallback = () => {
      if (!this.gameOverEmitted) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const state = this.room.state as any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const myPlayer = (state?.players as Map<string, any>)?.get(this.localPlayerId)
        this.emitGameOver(myPlayer)
      }
    }
    this.room.onLeave(this.leaveCallback)

    // Detach from the room on scene shutdown AND on game destroy: PhaserGame
    // unmounts with game.destroy(true), which emits DESTROY but never SHUTDOWN.
    // A co-op room outlives this scene (06-15), so a stale closure would sync a
    // destroyed scene / emit a run-1 gameover into run 2.
    const detach = () => this.detachRoomListeners()
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, detach)
    this.events.once(Phaser.Scenes.Events.DESTROY, detach)
  }

  /** Remove every listener this scene attached to the (possibly long-lived) room. */
  private detachRoomListeners(): void {
    if (this.stateCallback) {
      this.room.onStateChange.remove(this.stateCallback)
      this.stateCallback = undefined
    }
    if (this.leaveCallback) {
      this.room.onLeave.remove(this.leaveCallback)
      this.leaveCallback = undefined
    }
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

    // Co-op latch: state.lobby is empty for solo, non-empty in co-op (own entry).
    const lobby = state.lobby as Map<string, unknown> | undefined
    if (!this.isCoop && lobby !== undefined && lobby.size > 0) {
      this.isCoop = true
    }

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
        // Co-op follows the squad centroid instead (updateCoopCamera).
        if (key === this.localPlayerId && !this.isCoop) {
          this.cameras.main.startFollow(sprite, true, 0.1, 0.1)
        }
      } else {
        const sprite = this.playerSprites.get(key)!
        sprite.setPosition(toGU(player.x), toGU(player.y))
      }

      // Eliminated co-op players are spectators, not corpses: no sprite, no aura.
      const eliminated = this.isCoop && player.eliminated === true
      if (this.isCoop) {
        this.applyCoopPlayerVisuals(key, player, this.playerSprites.get(key)!)
      }

      let garlicItem: string | undefined
      if (player.weapons && typeof player.weapons.find === 'function') {
        garlicItem = player.weapons.find((w: string) => w.startsWith('garlic'))
      }
      if (garlicItem && !eliminated) {
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

      // Game-over: local player HP reaches 0 (solo only — in co-op hp 0 means
      // downed or eliminated, and the run continues for the squad).
      if (!this.isCoop && key === this.localPlayerId && player.hp <= 0 && !this.gameOverEmitted) {
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
    for (const key of this.reviveRings.keys()) {
      if (!players.has(key)) {
        this.reviveRings.get(key)!.destroy()
        this.reviveRings.delete(key)
      }
    }

    if (this.isCoop) {
      this.updateCoopCamera(players)
      // Full-squad defeat: every client shows the Phase 5 defeat summary.
      if (state.result === 'defeated' && !this.gameOverEmitted) {
        this.emitGameOver(players.get(this.localPlayerId))
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

  /**
   * Co-op in-world state visuals (UI-SPEC §7/§8), driven only by wire fields:
   * downed → amber tint @60% alpha (+ revive ring while reviveProgressTicks > 0),
   * eliminated → sprite hidden. Cleared back to normal on revive.
   */
  private applyCoopPlayerVisuals(
    key: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    player: any,
    sprite: Phaser.GameObjects.Sprite
  ): void {
    const eliminated = player.eliminated === true
    const downed = !eliminated && player.downed === true

    sprite.setVisible(!eliminated)
    if (downed) {
      sprite.setTint(DOWNED_TINT)
      sprite.setAlpha(DOWNED_ALPHA)
    } else {
      sprite.clearTint()
      sprite.setAlpha(1)
    }

    const progressTicks = (player.reviveProgressTicks as number | undefined) ?? 0
    if (downed && progressTicks > 0) {
      let ring = this.reviveRings.get(key)
      if (!ring) {
        ring = this.add.graphics()
        ring.setDepth(2.6) // above player sprites (2) and the aura layer (1.5)
        this.reviveRings.set(key, ring)
      }
      const x = toGU(player.x)
      const y = toGU(player.y)
      const frac = Math.min(1, progressTicks / REVIVE_TICKS)
      const start = -Math.PI / 2
      ring.clear()
      ring.lineStyle(REVIVE_RING_WIDTH, REVIVE_RING_TRACK_COLOR, REVIVE_RING_TRACK_ALPHA)
      ring.strokeCircle(x, y, REVIVE_RING_RADIUS)
      ring.lineStyle(REVIVE_RING_WIDTH, REVIVE_RING_COLOR, 1)
      ring.beginPath()
      ring.arc(x, y, REVIVE_RING_RADIUS, start, start + frac * Math.PI * 2, false)
      ring.strokePath()
    } else {
      const ring = this.reviveRings.get(key)
      if (ring) {
        ring.destroy()
        this.reviveRings.delete(key)
      }
    }
  }

  /**
   * Co-op centroid camera (ROOM-05/09). Anchor = the local player, or — when
   * the local player is eliminated (spectating) — the first living player.
   * Teammates = every OTHER non-eliminated player (downed still counts). The
   * centroid is kept in the anchor's frame and NOT wrapped: sprites render at
   * raw [0, 4096) positions, so wrapping could park the camera on the far side
   * of the world from the anchor; the camera bounds clamp it instead.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private updateCoopCamera(players: Map<string, any>): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const living: Array<[string, any]> = []
    for (const [key, p] of players) {
      if (p.eliminated !== true) living.push([key, p])
    }
    const local = players.get(this.localPlayerId)
    const anchorKey =
      local !== undefined && local.eliminated !== true ? this.localPlayerId : living[0]?.[0]
    // Nobody left alive: leave the camera where it is (defeat is imminent).
    if (anchorKey === undefined) return

    const anchor = players.get(anchorKey)
    const teammates = living
      .filter(([key]) => key !== anchorKey)
      .map(([, p]) => ({ x: p.x as number, y: p.y as number }))
    const target = computeCameraTarget(
      { x: anchor.x as number, y: anchor.y as number },
      teammates,
      WORLD_W // square world (WORLD_W === WORLD_H)
    )

    // Write the target BEFORE the first startFollow: it snaps scroll to it.
    this.cameraTarget.x = toGU(target.x)
    this.cameraTarget.y = toGU(target.y)
    this.targetZoom = computeZoom(
      toGU(target.maxAbsDx),
      toGU(target.maxAbsDy),
      this.scale.width,
      this.scale.height
    )

    if (!this.followSwitched) {
      this.followSwitched = true
      // roundPixels false: non-integer zoom breaks the rounding fix (Pattern 7).
      this.cameras.main.startFollow(this.cameraTarget, false, 0.1, 0.1)
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
    // Leave-while-alive (server disconnect, voluntary exit routed via Phaser):
    // mirror SoloRoom.onLeave's rule — not dead at leave time means survived.
    const syncedResult = (state?.result as string) ?? ''
    const result = syncedResult || (player && player.hp > 0 ? 'survived' : '')

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
    // Co-op full-squad defeat: the room survives and reopens as a lobby
    // (06-15) — the summary is shown over a live room, so do NOT leave.
    if (this.isCoop && syncedResult === 'defeated') return
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

    // Pick/slot-full modal open (06-11 registry contract): keep sending, but
    // with a zero moveVector so no stale vector keeps applying server-side.
    if (this.game.registry.get('inputLocked') === true) {
      mx = 0
      my = 0
    }

    // Co-op dynamic zoom: manual per-frame lerp toward the computed target.
    if (this.isCoop) {
      const cam = this.cameras.main
      const diff = this.targetZoom - cam.zoom
      if (diff !== 0) {
        cam.setZoom(Math.abs(diff) < 0.001 ? this.targetZoom : cam.zoom + diff * ZOOM_LERP)
      }
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
