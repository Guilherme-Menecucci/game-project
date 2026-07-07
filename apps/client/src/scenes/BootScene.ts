/**
 * BootScene — creates the 27-frame DynamicTexture atlas and transitions to GameScene.
 *
 * Single atlas 'entities' (512x192 px) covers all entity types in one GL texture binding
 * (GAME-18 — single draw call per batch).
 *
 * Frame layout (pixel offsets within atlas):
 *
 * Row 0 — original frames, fixed positions (unchanged, GameScene already references these):
 *   player              x=0    y=0   w=20 h=20  green rect          (#22c55e)
 *   swarmer             x=24   y=0   w=10 h=10  brown circle r=5     (#7a5230) — Mutant Rat (D-18, redrawn in-place)
 *   gem                 x=102  y=0   w=12 h=12  cyan circle r=6      (#06b6d4) — fallback, kept for compat
 *   proj_player         x=118  y=0   w=8  h=8   white circle r=4     (#ffffff)
 *   proj_enemy          x=130  y=0   w=8  h=8   orange-red circle r=4 (#fb923c) (GAME-05)
 *   proj_magic_wand     x=142  y=0   w=8  h=8   orange-red circle r=4 (#ff6b00)
 *   proj_knife          x=154  y=0   w=8  h=8   gray circle r=4       (#9ca3af)
 *   proj_bible          x=166  y=0   w=8  h=8   brown circle r=4      (#8b5a2b)
 *   proj_holy_wand      x=178  y=0   w=8  h=8   golden yellow circle r=4 (#fbbf24)
 *   proj_thousand_edge  x=190  y=0   w=8  h=8   cyan steel circle r=4 (#38bdf8)
 *
 * Row 1+ — row-packed frames via the addFrame() helper, starting at (0, 32):
 *   tank                          x=0   y=32  w=28 h=32  rect              (#e8d5d5) — Zombie Nurse (D-18, repositioned)
 *   ranged                        x=28  y=32  w=30 h=12  L-shape rect      (#eab308) — Walking Arm (D-18, repositioned)
 *   lab_floor_tile                x=58  y=32  w=32 h=32  tile w/ grid+stains (#23262f base) (D-08)
 *   player_vampire                x=90  y=32  w=16 h=26  rect              (#4b2e6e) (D-09)
 *   player_human                  x=106 y=32  w=18 h=22  rect              (#6b6b7a) (D-09)
 *   player_dwarf                  x=124 y=32  w=22 h=16  rect              (#8b5a2b) (D-09)
 *   elite_stitched_orderly        x=146 y=32  w=14 h=14  circle r=7        (#7a5230) (D-25)
 *   elite_the_harvester           x=160 y=32  w=42 h=17  rect              (#d9a3a3) (D-25)
 *   elite_meat_golem              x=202 y=32  w=39 h=45  rect              (#e8d5d5) (D-25)
 *   elite_brain_jar_crawler       x=241 y=32  w=22 h=26  jar+legs composite (#4a9eff jar / #7a5230 legs) (D-25)
 *   elite_brain_jar_crawler_split x=263 y=32  w=11 h=13  jar+legs composite (50% scale) (D-25)
 *   boss_patient_zero             x=274 y=32  w=36 h=66  body+head composite (#a33d3d) (D-18)
 *   boss_unfinished_one           x=310 y=32  w=56 h=64  rect              (#3d3d4a) (D-18)
 *   pickup_gem                    x=366 y=32  w=6  h=12  body+glow composite (#9be15d / #d4f7a1) (D-10) — Serum Vial
 *   pickup_health_orb             x=372 y=32  w=10 h=14  neck+body composite (#e05252) (D-10) — Formaldehyde Flask
 *   pickup_xp_magnet              x=382 y=32  w=14 h=15  body+lid composite  (#4a9eff / #8a8a9a) (D-10) — Specimen Jar
 *   pickup_screen_bomb            x=396 y=32  w=12 h=14  canister+stripe composite (#b266ff / #ffcc00) (D-10) — Unstable Chemical
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
    // Create a single 512x192 DynamicTexture for all entity frames (GAME-18).
    const atlas = this.textures.addDynamicTexture('entities', 512, 192)
    if (!atlas) throw new Error('Failed to create entity atlas')

    // Graphics object used to draw each frame into the atlas at absolute positions.
    // Second arg false: do not add to the scene display list.
    const g = this.make.graphics({ x: 0, y: 0 }, false)

    // --- Row-packing helper for all frames added after the original row-0 set. ---
    // Starts at (0, 32) — row 0 (y=0..31) is reserved for the original fixed-position
    // frames above and must not be overwritten by the packer.
    const ATLAS_W = 512
    let cursorX = 0
    let cursorY = 32
    let rowH = 0

    const addFrame = (
      name: string,
      w: number,
      h: number,
      drawFn: (ox: number, oy: number) => void
    ): void => {
      if (cursorX + w > ATLAS_W) {
        cursorX = 0
        cursorY += rowH
        rowH = 0
      }
      g.clear()
      drawFn(cursorX, cursorY)
      atlas.draw(g)
      atlas.add(name, 0, cursorX, cursorY, w, h)
      cursorX += w
      if (h > rowH) rowH = h
    }

    // --- player frame: green rect 20x20 at (0, 0) ---
    g.fillStyle(0x22c55e)
    g.fillRect(0, 0, 20, 20)
    atlas.draw(g)
    atlas.add('player', 0, 0, 0, 20, 20)

    // --- swarmer frame: Mutant Rat — brown circle r=5 at (24, 0), center=(29,5) (D-18, redrawn in-place) ---
    g.clear()
    g.fillStyle(0x7a5230)
    g.fillCircle(29, 5, 5)
    atlas.draw(g)
    atlas.add('swarmer', 0, 24, 0, 10, 10)

    // --- gem frame: cyan circle r=6 at (102, 0), center=(108,6) — kept for fallback ---
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

    // --- proj_magic_wand: orange-red circle r=4 at (142, 0), center=(146,4) ---
    g.clear()
    g.fillStyle(0xff6b00)
    g.fillCircle(146, 4, 4)
    atlas.draw(g)
    atlas.add('proj_magic_wand', 0, 142, 0, 8, 8)

    // --- proj_knife: gray circle r=4 at (154, 0), center=(158,4) ---
    g.clear()
    g.fillStyle(0x9ca3af)
    g.fillCircle(158, 4, 4)
    atlas.draw(g)
    atlas.add('proj_knife', 0, 154, 0, 8, 8)

    // --- proj_bible: brown circle r=4 at (166, 0), center=(170,4) ---
    g.clear()
    g.fillStyle(0x8b5a2b)
    g.fillCircle(170, 4, 4)
    atlas.draw(g)
    atlas.add('proj_bible', 0, 166, 0, 8, 8)

    // --- proj_holy_wand: golden yellow circle r=4 at (178, 0), center=(182,4) ---
    g.clear()
    g.fillStyle(0xfbbf24)
    g.fillCircle(182, 4, 4)
    atlas.draw(g)
    atlas.add('proj_holy_wand', 0, 178, 0, 8, 8)

    // --- proj_thousand_edge: cyan steel circle r=4 at (190, 0), center=(194,4) ---
    g.clear()
    g.fillStyle(0x38bdf8)
    g.fillCircle(194, 4, 4)
    atlas.draw(g)
    atlas.add('proj_thousand_edge', 0, 190, 0, 8, 8)

    // --- tank frame: Zombie Nurse — rect 28x32, color 0xe8d5d5 (D-18, repositioned via addFrame) ---
    addFrame('tank', 28, 32, (ox, oy) => {
      g.fillStyle(0xe8d5d5)
      g.fillRect(ox, oy, 28, 32)
    })

    // --- ranged frame: Walking Arm — L-shape rect 30x12, color 0xeab308 (D-18, repositioned via addFrame) ---
    addFrame('ranged', 30, 12, (ox, oy) => {
      g.fillStyle(0xeab308)
      g.fillRect(ox, oy, 24, 12)
      g.fillRect(ox + 24, oy, 6, 6)
    })

    // --- lab_floor_tile: 32x32 tile with grid lines and stains (D-08) ---
    addFrame('lab_floor_tile', 32, 32, (ox, oy) => {
      g.fillStyle(0x23262f)
      g.fillRect(ox, oy, 32, 32)
      g.fillStyle(0x2f323d)
      g.fillRect(ox + 31, oy, 1, 32)
      g.fillRect(ox, oy + 31, 32, 1)
      g.fillStyle(0x3a2f2f)
      g.fillCircle(ox + 8, oy + 8, 3)
      g.fillCircle(ox + 20, oy + 14, 2)
      g.fillCircle(ox + 14, oy + 24, 4)
    })

    // --- player_vampire: 16x26 rect, color 0x4b2e6e (D-09) ---
    addFrame('player_vampire', 16, 26, (ox, oy) => {
      g.fillStyle(0x4b2e6e)
      g.fillRect(ox, oy, 16, 26)
    })

    // --- player_human: 18x22 rect, color 0x6b6b7a (D-09) ---
    addFrame('player_human', 18, 22, (ox, oy) => {
      g.fillStyle(0x6b6b7a)
      g.fillRect(ox, oy, 18, 22)
    })

    // --- player_dwarf: 22x16 rect, color 0x8b5a2b (D-09) ---
    addFrame('player_dwarf', 22, 16, (ox, oy) => {
      g.fillStyle(0x8b5a2b)
      g.fillRect(ox, oy, 22, 16)
    })

    // --- elite_stitched_orderly: 14px diameter circle, color 0x7a5230 (D-25) ---
    addFrame('elite_stitched_orderly', 14, 14, (ox, oy) => {
      g.fillStyle(0x7a5230)
      g.fillCircle(ox + 7, oy + 7, 7)
    })

    // --- elite_the_harvester: 42x17 rect, color 0xd9a3a3 (D-25) ---
    addFrame('elite_the_harvester', 42, 17, (ox, oy) => {
      g.fillStyle(0xd9a3a3)
      g.fillRect(ox, oy, 42, 17)
    })

    // --- elite_meat_golem: 39x45 rect, color 0xe8d5d5 (D-25) ---
    addFrame('elite_meat_golem', 39, 45, (ox, oy) => {
      g.fillStyle(0xe8d5d5)
      g.fillRect(ox, oy, 39, 45)
    })

    // --- elite_brain_jar_crawler: jar (16px diameter circle, 0x4a9eff) + 2 legs (3x10 rects, 0x7a5230) (D-25) ---
    addFrame('elite_brain_jar_crawler', 22, 26, (ox, oy) => {
      g.fillStyle(0x4a9eff)
      g.fillCircle(ox + 11, oy + 8, 8)
      g.fillStyle(0x7a5230)
      g.fillRect(ox + 3, oy + 16, 3, 10)
      g.fillRect(ox + 16, oy + 16, 3, 10)
    })

    // --- elite_brain_jar_crawler_split: jar (8px diameter circle, 0x4a9eff) + 2 legs (1.5x5 rects, 0x7a5230) (D-25, 50% scale death-split) ---
    addFrame('elite_brain_jar_crawler_split', 11, 13, (ox, oy) => {
      g.fillStyle(0x4a9eff)
      g.fillCircle(ox + 5, oy + 4, 4)
      g.fillStyle(0x7a5230)
      g.fillRect(ox + 1.5, oy + 8, 1.5, 5)
      g.fillRect(ox + 8, oy + 8, 1.5, 5)
    })

    // --- boss_patient_zero: body (36x48 rect, 0xa33d3d) + head (18px diameter circle, 0xa33d3d) (D-18) ---
    addFrame('boss_patient_zero', 36, 66, (ox, oy) => {
      g.fillStyle(0xa33d3d)
      g.fillRect(ox, oy + 18, 36, 48)
      g.fillCircle(ox + 18, oy + 9, 9)
    })

    // --- boss_unfinished_one: 56x64 rect, color 0x3d3d4a (D-18) ---
    addFrame('boss_unfinished_one', 56, 64, (ox, oy) => {
      g.fillStyle(0x3d3d4a)
      g.fillRect(ox, oy, 56, 64)
    })

    // --- pickup_gem (Serum Vial): body (6x9 rect, 0x9be15d) + glow cap (6x3 rect, 0xd4f7a1) (D-10) ---
    addFrame('pickup_gem', 6, 12, (ox, oy) => {
      g.fillStyle(0x9be15d)
      g.fillRect(ox, oy + 3, 6, 9)
      g.fillStyle(0xd4f7a1)
      g.fillRect(ox, oy, 6, 3)
    })

    // --- pickup_health_orb (Formaldehyde Flask): neck (4x4 rect) + body (10x10 rect), both 0xe05252 (D-10) ---
    addFrame('pickup_health_orb', 10, 14, (ox, oy) => {
      g.fillStyle(0xe05252)
      g.fillRect(ox + 3, oy, 4, 4)
      g.fillRect(ox, oy + 4, 10, 10)
    })

    // --- pickup_xp_magnet (Specimen Jar): body (12x12 rect, 0x4a9eff) + lid (14x3 rect, 0x8a8a9a) (D-10) ---
    addFrame('pickup_xp_magnet', 14, 15, (ox, oy) => {
      g.fillStyle(0x4a9eff)
      g.fillRect(ox + 1, oy + 3, 12, 12)
      g.fillStyle(0x8a8a9a)
      g.fillRect(ox, oy, 14, 3)
    })

    // --- pickup_screen_bomb (Unstable Chemical): canister (12x14 rect, 0xb266ff) + stripe (12x2 rect, 0xffcc00) (D-10) ---
    addFrame('pickup_screen_bomb', 12, 14, (ox, oy) => {
      g.fillStyle(0xb266ff)
      g.fillRect(ox, oy, 12, 14)
      g.fillStyle(0xffcc00)
      g.fillRect(ox, oy + 6, 12, 2)
    })

    // Free the graphics object — all frames registered, no longer needed.
    g.destroy()

    // Read room from registry (set by PhaserGame.tsx after game creation).
    // Pass it as scene data so GameScene can access it in create(data).
    const room = this.game.registry.get('room') as unknown
    this.scene.start('GameScene', { room })
  }
}
