import { useRef, useState } from 'react'
import type { Room } from '@colyseus/sdk'
import { Client } from '@colyseus/sdk'
import { useAuth } from '../components/auth/AuthProvider.js'
import { SoloRunStartScreen } from '../components/game/SoloRunStartScreen.js'
import { PhaserGame } from '../components/game/PhaserGame.js'
import styles from './GamePage.module.css'

export type GamePhase = 'IDLE' | 'CONNECTING' | 'ACTIVE' | 'GAME-OVER'

export type GameError =
  | 'SESSION_EXPIRED'
  | 'SERVER_ERROR'
  | 'GAME_SERVER_UNREACHABLE'
  | 'TOKEN_REJECTED'
  | null

export function GamePage() {
  const { user } = useAuth()
  const [phase, setPhase] = useState<GamePhase>('IDLE')
  const [error, setError] = useState<GameError>(null)
  const roomRef = useRef<Room | null>(null)

  async function handleSoloRun() {
    setPhase('CONNECTING')
    setError(null)

    // Step 1: Fetch game token (session cookie required — D-05)
    let token: string
    try {
      const res = await fetch('/api/auth/game-token', { credentials: 'include' })
      if (res.status === 401) {
        setPhase('IDLE')
        setError('SESSION_EXPIRED')
        return
      }
      if (!res.ok) {
        // 403 or 5xx — treat as server error (UI-SPEC entry flow copywriting)
        setPhase('IDLE')
        setError('SERVER_ERROR')
        return
      }
      const data = (await res.json()) as { token: string }
      token = data.token
    } catch {
      // Network error
      setPhase('IDLE')
      setError('SERVER_ERROR')
      return
    }

    // Step 2: Connect to Colyseus solo_room via /colyseus proxy (D-10)
    try {
      const client = new Client('/colyseus')
      const room = await client.joinOrCreate<unknown>('solo_room', { token })
      roomRef.current = room as Room
      setPhase('ACTIVE')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('ECONNREFUSED') || msg.includes('timeout') || msg.includes('connect')) {
        setError('GAME_SERVER_UNREACHABLE')
      } else if (
        msg.includes('token') ||
        msg.includes('401') ||
        msg.includes('403') ||
        msg.includes('auth')
      ) {
        setError('TOKEN_REJECTED')
      } else {
        setError('SERVER_ERROR')
      }
      setPhase('IDLE')
    }
  }

  function handleGameOver() {
    // ACTIVE → GAME-OVER → IDLE (deliberate pause — player must click Solo Run again)
    setPhase('IDLE')
  }

  return (
    <div className={styles.page}>
      {(phase === 'IDLE' || phase === 'CONNECTING') && (
        <SoloRunStartScreen
          phase={phase}
          error={error}
          user={user}
          onSoloRun={() => void handleSoloRun()}
        />
      )}
      {phase === 'ACTIVE' && roomRef.current && (
        <PhaserGame room={roomRef.current} onGameOver={handleGameOver} />
      )}
      {phase === 'GAME-OVER' && (
        <div className={styles.gameOver}>
          <h2 className={styles.gameOverHeading}>Game Over</h2>
          <button className={styles.tryAgainBtn} type="button" onClick={handleGameOver}>
            Try Again
          </button>
        </div>
      )}
    </div>
  )
}
