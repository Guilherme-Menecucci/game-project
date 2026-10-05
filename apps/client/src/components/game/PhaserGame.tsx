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
  weapons?: string[]
  passives?: string[]
  /** Mirrors GameStateSchema.result — 'survived' | 'defeated' | ''. */
  result?: string
  /** Mirrors PlayerSchema.weaponStats, flattened from the Colyseus MapSchema, keyed by slot index. */
  weaponStats?: Record<string, { totalDamage: number; acquiredAtMs: number }>
}

/**
 * Registry key (string contract, no compile-time coupling) read by GameScene
 * (plan 06-12): boolean — true while the local player has an upgrade picker or
 * slot-full modal open. In co-op the world keeps running during a pick and the
 * server already drops the picker's moveVector (06-09 filterInputs); the scene
 * sends a ZERO moveVector while this is set. Harmless in solo (world paused).
 */
const INPUT_LOCKED_REGISTRY_KEY = 'inputLocked'

interface PhaserGameProps {
  room: Room
  onGameOver: (data: GameOverData) => void
  /** Locks local movement intent (co-op pick/slot-full overlays). Default false. */
  inputLocked?: boolean
}

export function PhaserGame({ room, onGameOver, inputLocked = false }: PhaserGameProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onGameOverRef = useRef(onGameOver)
  const gameRef = useRef<Phaser.Game | null>(null)
  // Latest lock value for a game (re)created on a new room — the dedicated
  // effect below only re-runs when the prop changes.
  const inputLockedRef = useRef(inputLocked)

  // Keep callback ref fresh without triggering effects
  useEffect(() => {
    onGameOverRef.current = onGameOver
  }, [onGameOver])

  useEffect(() => {
    if (!containerRef.current) return

    // Store refs so cleanup closure captures them (not the reactive values)
    const container = containerRef.current
    const _room = room

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.CANVAS,
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
    game.registry.set(INPUT_LOCKED_REGISTRY_KEY, inputLockedRef.current)
    gameRef.current = game

    // Listen for game-over event emitted by GameScene when player hp <= 0 or room leaves.
    game.events.on('gameover', (data: GameOverData) => {
      onGameOverRef.current(data)
    })

    // CRITICAL: game.destroy(true) removes the canvas from the DOM.
    // Without `true`, React 19 Strict Mode double-mount leaves orphaned canvas elements (D-09).
    return () => {
      if (gameRef.current === game) gameRef.current = null
      game.destroy(true)
    }
  }, [room])

  // GamePage → scene bridge for the local input lock (same registry channel
  // the room travels on). Declared after the creation effect so on mount the
  // game already exists when this runs.
  useEffect(() => {
    inputLockedRef.current = inputLocked
    gameRef.current?.registry.set(INPUT_LOCKED_REGISTRY_KEY, inputLocked)
  }, [inputLocked])

  return <div ref={containerRef} className={styles.canvas} style={{ zIndex: 0 }} />
}
