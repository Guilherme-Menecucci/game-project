import Phaser from 'phaser'
import { useEffect, useRef } from 'react'
import type { Room } from '@colyseus/sdk'
import { BootScene } from '../../scenes/BootScene.js'
import { GameScene } from '../../scenes/GameScene.js'
import styles from './PhaserGame.module.css'

export interface GameOverData {
  killCount: number
  elapsedMs: number
  level: number
  xp: number
}

interface PhaserGameProps {
  room: Room
  onGameOver: (data: GameOverData) => void
}

export function PhaserGame({ room, onGameOver }: PhaserGameProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Store refs so cleanup closure captures them (not the reactive values)
    const container = containerRef.current
    const _room = room
    const _onGameOver = onGameOver

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: '#1e2030', // arena ground color — UI-SPEC Game Canvas Palette
      parent: container,
      // BootScene creates the DynamicTexture atlas then starts GameScene.
      // GameScene renders Colyseus state, captures input, and emits 'gameover'.
      scene: [BootScene, GameScene],
    }

    const game = new Phaser.Game(config)

    // Pass room reference via registry so BootScene can read it in create().
    // BootScene forwards it to GameScene via scene.start('GameScene', { room }).
    game.registry.set('room', _room)
    game.registry.set('killCount', 0)

    // Listen for game-over event emitted by GameScene when player hp <= 0 or room leaves.
    game.events.on('gameover', (data: GameOverData) => {
      _onGameOver(data)
    })

    // CRITICAL: game.destroy(true) removes the canvas from the DOM.
    // Without `true`, React 19 Strict Mode double-mount leaves orphaned canvas elements (D-09).
    return () => {
      game.destroy(true)
    }
  }, [room, onGameOver])

  return <div ref={containerRef} className={styles.canvas} style={{ zIndex: 0 }} />
}
