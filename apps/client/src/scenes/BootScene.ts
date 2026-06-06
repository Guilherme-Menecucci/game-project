/**
 * BootScene — creates the 7-frame DynamicTexture atlas and transitions to GameScene.
 *
 * Single atlas 'entities' (256x64 px) covers all entity types in one GL texture binding
 * (GAME-18 — single draw call per batch).
 *
 * Frame layout (pixel offsets within atlas):
 *   player     x=0   y=0  w=20 h=20  green rect     (#22c55e)
 *   swarmer    x=24  y=0  w=10 h=10  red rect       (#ef4444)
 *   tank       x=38  y=0  w=28 h=28  orange rect    (#f97316)
 *   ranged     x=70  y=0  w=28 h=28  yellow circle  (#eab308) r=14
 *   gem        x=102 y=0  w=12 h=12  cyan circle    (#06b6d4) r=6
 *   proj_player x=118 y=0 w=8  h=8   white circle   (#ffffff) r=4
 *   proj_enemy  x=130 y=0 w=8  h=8   orange-red circle (#fb923c) r=4 (GAME-05)
 *
 * Reads room from game.registry ('room') and starts GameScene with { room } data.
 */
import Phaser from 'phaser'

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' })
  }

  preload(): void {
    // No external assets — all entity graphics are drawn programmatically.
  }

  create(): void {
    // Create a single 256x64 DynamicTexture for all entity frames (GAME-18).
    const atlas = this.textures.addDynamicTexture('entities', 256, 64)
    if (!atlas) throw new Error('Failed to create entity atlas')

    // Graphics object used to draw each frame into the atlas at absolute positions.
    // Second arg false: do not add to the scene display list.
    const g = this.make.graphics({ x: 0, y: 0 }, false)

    // --- player frame: green rect 20x20 at (0, 0) ---
    g.fillStyle(0x22c55e)
    g.fillRect(0, 0, 20, 20)
    atlas.draw(g)
    atlas.add('player', 0, 0, 0, 20, 20)

    // --- swarmer frame: red rect 10x10 at (24, 0) ---
    g.clear()
    g.fillStyle(0xef4444)
    g.fillRect(24, 0, 10, 10)
    atlas.draw(g)
    atlas.add('swarmer', 0, 24, 0, 10, 10)

    // --- tank frame: orange rect 28x28 at (38, 0) ---
    g.clear()
    g.fillStyle(0xf97316)
    g.fillRect(38, 0, 28, 28)
    atlas.draw(g)
    atlas.add('tank', 0, 38, 0, 28, 28)

    // --- ranged frame: yellow circle r=14 at (70, 0), center=(84,14) ---
    g.clear()
    g.fillStyle(0xeab308)
    g.fillCircle(84, 14, 14)
    atlas.draw(g)
    atlas.add('ranged', 0, 70, 0, 28, 28)

    // --- gem frame: cyan circle r=6 at (102, 0), center=(108,6) ---
    g.clear()
    g.fillStyle(0x06b6d4)
    g.fillCircle(108, 6, 6)
    atlas.draw(g)
    atlas.add('gem', 0, 102, 0, 12, 12)

    // --- proj_player frame: white circle r=4 at (118, 0), center=(122,4) ---
    g.clear()
    g.fillStyle(0xffffff)
    g.fillCircle(122, 4, 4)
    atlas.draw(g)
    atlas.add('proj_player', 0, 118, 0, 8, 8)

    // --- proj_enemy frame: orange-red circle r=4 at (130, 0), center=(134,4) (GAME-05) ---
    g.clear()
    g.fillStyle(0xfb923c)
    g.fillCircle(134, 4, 4)
    atlas.draw(g)
    atlas.add('proj_enemy', 0, 130, 0, 8, 8)

    // Free the graphics object — all frames registered, no longer needed.
    g.destroy()

    // Read room from registry (set by PhaserGame.tsx after game creation).
    // Pass it as scene data so GameScene can access it in create(data).
    const room = this.game.registry.get('room') as unknown
    this.scene.start('GameScene', { room })
  }
}
