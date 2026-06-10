import { useRef, useState, useCallback } from 'react'
import type { Room } from '@colyseus/sdk'
import { Client } from '@colyseus/sdk'
import { useAuth } from '../components/auth/AuthProvider.js'
import { SoloRunStartScreen } from '../components/game/SoloRunStartScreen.js'
import { PhaserGame } from '../components/game/PhaserGame.js'
import type { GameOverData } from '../components/game/PhaserGame.js'
import { GameHUD } from '../components/game/GameHUD.js'
import { GameOverScreen } from '../components/game/GameOverScreen.js'
import { UpgradePicker } from '../components/ui/UpgradePicker.js'
import { SlotFullModal } from '../components/ui/SlotFullModal.js'
import type { UpgradeOption } from '@game/shared'
import styles from './GamePage.module.css'

export type GamePhase = 'IDLE' | 'CONNECTING' | 'ACTIVE' | 'UPGRADING' | 'SLOT_FULL' | 'GAME-OVER'

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
  const [pendingChoices, setPendingChoices] = useState<UpgradeOption[]>([])
  const [slotFullPayload, setSlotFullPayload] = useState<{
    weapons: string[]
    upgradeId: string
  } | null>(null)

  // Final stats captured from game-over event (populated on GAME-OVER transition)
  const [finalStats, setFinalStats] = useState<GameOverData>({
    killCount: 0,
    elapsedMs: 0,
    level: 1,
    xp: 0,
  })

  const [weapons, setWeapons] = useState<string[]>([])
  const [passives, setPassives] = useState<string[]>([])

  async function handleSoloRun() {
    setPhase('CONNECTING')
    setError(null)
    setWeapons([])
    setPassives([])

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

      // Track weapons and passives
      room.onStateChange(
        (state: { players?: Map<string, { weapons?: string[]; passives?: string[] }> }) => {
          const myPlayer = state.players?.get(room.sessionId)
          if (myPlayer) {
            if (myPlayer.weapons) {
              setWeapons(Array.from(myPlayer.weapons))
            }
            if (myPlayer.passives) {
              setPassives(Array.from(myPlayer.passives))
            }
          }
        }
      )

      // Add progression listeners
      room.onMessage('levelup', (data: { options: UpgradeOption[] }) => {
        setPendingChoices(data.options)
        setPhase('UPGRADING')
      })

      room.onMessage('slot_full', (data: { weapons: string[]; upgradeId: string }) => {
        setSlotFullPayload(data)
        setPhase('SLOT_FULL')
      })

      room.onMessage('rare_event', (data: { options: UpgradeOption[] }) => {
        setPendingChoices(data.options)
        setPhase('UPGRADING')
      })

      room.onMessage('upgrade_applied', () => {
        setPhase('ACTIVE')
        setPendingChoices([])
        setSlotFullPayload(null)
      })

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

  const handleUpgradeSelect = useCallback((upgradeId: string) => {
    roomRef.current?.send('upgrade_selected', { upgradeId })
    setPhase('ACTIVE')
    setPendingChoices([])
  }, [])

  const handleReplace = useCallback(
    (slot: number) => {
      if (slotFullPayload) {
        roomRef.current?.send('replace_slot', { slot, upgradeId: slotFullPayload.upgradeId })
        setPhase('ACTIVE')
        setSlotFullPayload(null)
      }
    },
    [slotFullPayload]
  )

  const handleGameOver = useCallback((data: GameOverData) => {
    // ACTIVE → GAME-OVER: capture final stats, show GameOverScreen
    setFinalStats(data)
    setPhase('GAME-OVER')
  }, [])

  const handleRetry = useCallback(() => {
    // GAME-OVER → IDLE: deliberate pause — player must click "Solo Run" again
    // This is a deliberate pause point giving breathing room before the next run.
    setPhase('IDLE')
  }, [])

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
      {(phase === 'ACTIVE' || phase === 'UPGRADING' || phase === 'SLOT_FULL') &&
        roomRef.current && (
          <>
            <PhaserGame room={roomRef.current} onGameOver={handleGameOver} />
            <GameHUD room={roomRef.current} />
          </>
        )}
      {phase === 'UPGRADING' && (
        <UpgradePicker
          options={pendingChoices}
          onSelect={handleUpgradeSelect}
          weapons={weapons}
          passives={passives}
        />
      )}
      {phase === 'SLOT_FULL' && slotFullPayload && (
        <SlotFullModal
          weapons={slotFullPayload.weapons}
          upgradeId={slotFullPayload.upgradeId}
          onReplace={handleReplace}
        />
      )}
      {phase === 'GAME-OVER' && (
        <GameOverScreen
          stats={{
            elapsedMs: finalStats.elapsedMs,
            kills: finalStats.killCount,
            level: finalStats.level,
            xp: finalStats.xp,
            weapons: weapons,
            passives: passives,
          }}
          onRetry={handleRetry}
        />
      )}
    </div>
  )
}
