import Phaser from 'phaser'
import { useEffect, useRef } from 'react'
import type { Room } from '@colyseus/sdk'
import styles from './PhaserGame.module.css'

interface PhaserGameProps {
  room: Room
  onGameOver: () => void
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
      scene: [], // GameScene added in plan 03-08
    }

    const game = new Phaser.Game(config)

    // Wire game-over signal from room (plan 03-08 will attach scene; shell uses onLeave)
    _room.onLeave(() => {
      _onGameOver()
    })

    // CRITICAL: game.destroy(true) removes the canvas from the DOM.
    // Without `true`, React 19 Strict Mode double-mount leaves orphaned canvas elements (D-09).
    return () => {
      game.destroy(true)
    }
  }, [room, onGameOver])

  return <div ref={containerRef} className={styles.canvas} style={{ zIndex: 0 }} />
}
