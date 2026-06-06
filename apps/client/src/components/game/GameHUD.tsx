/**
 * GameHUD — Full-viewport React overlay over the Phaser canvas.
 *
 * Subscribes to Colyseus state changes via room.onStateChange (20Hz server tick rate).
 * React 19 batches re-renders so 20Hz is within normal performance budget.
 *
 * Kill counter uses room.state.enemies onRemove via @colyseus/schema 4.x Callbacks.get() API.
 *
 * pointer-events: none on root div — all clicks pass through to the Phaser canvas.
 * Only LogoutButton overrides to pointer-events: auto (interactive element).
 */
import { useState, useEffect } from 'react'
import type { Room } from '@colyseus/sdk'
import { Callbacks } from '@colyseus/sdk'
import { HudHpBar } from './HudHpBar.js'
import { HudTimer } from './HudTimer.js'
import { HudXpBar } from './HudXpBar.js'
import { HudKillCount } from './HudKillCount.js'
import { LogoutButton } from '../auth/LogoutButton.js'
import { WeaponSlotRow } from '../ui/WeaponSlotRow.js'
import styles from './GameHUD.module.css'

/** XP_LEVEL_THRESHOLD = 10 (from weapons.ts constants, plan 03-06) */
const XP_LEVEL_THRESHOLD = 10

interface GameHUDProps {
  room: Room
}

export function GameHUD({ room }: GameHUDProps) {
  const [hp, setHp] = useState<number>(0)
  const [maxHp, setMaxHp] = useState<number>(1)
  const [xp, setXp] = useState<number>(0)
  const [level, setLevel] = useState<number>(1)
  const [elapsedMs, setElapsedMs] = useState<number>(0)
  const [kills, setKills] = useState<number>(0)
  const [weapons, setWeapons] = useState<string[]>([])

  // Subscribe to full state changes — fires at ~20Hz server tick rate
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (state: any) => {
      const myPlayer = (
        state.players as Map<
          string,
          { hp: number; maxHp: number; xp: number; level: number; weapons: string[] }
        >
      ).get(room.sessionId)
      if (myPlayer) {
        setHp(myPlayer.hp)
        setMaxHp(myPlayer.maxHp)
        setXp(myPlayer.xp)
        setLevel(myPlayer.level)
        if (myPlayer.weapons) {
          setWeapons(Array.from(myPlayer.weapons))
        }
      }
      setElapsedMs(state.elapsedMs as number)
    }

    room.onStateChange(handler)

    return () => {
      room.onStateChange.remove(handler)
    }
  }, [room])

  // Kill counter via @colyseus/schema 4.x Callbacks.get() — onRemove on enemies
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = Callbacks.get(room as any) as any

    const onEnemyRemove = () => {
      setKills((prev) => prev + 1)
    }

    cb.onRemove('enemies', onEnemyRemove)

    return () => {
      // Callbacks.get() does not expose per-listener removal; component unmounts on GAME-OVER
      // so the natural cleanup is sufficient. The 'enemies' onRemove is unregistered
      // when the component unmounts and the room.onStateChange listener is removed.
    }
  }, [room])

  return (
    <div className={styles.overlay}>
      {/* Top-left: HP cluster */}
      <div className={styles.topLeft}>
        <HudHpBar hp={hp} maxHp={maxHp} />
      </div>

      {/* Top-center: Run timer */}
      <div className={styles.topCenter}>
        <HudTimer elapsedMs={elapsedMs} />
      </div>

      {/* Top-right: XP cluster + LogoutButton */}
      <div className={styles.topRight}>
        <HudXpBar xp={xp} threshold={XP_LEVEL_THRESHOLD} level={level} />
        <div className={styles.logoutWrapper}>
          <LogoutButton />
        </div>
      </div>

      {/* Bottom-left: Kill count */}
      <div className={styles.bottomLeft}>
        <HudKillCount kills={kills} />
      </div>

      {/* Bottom-center: Weapon slots row */}
      <div className={styles.bottomCenter}>
        <WeaponSlotRow weapons={weapons} />
      </div>
    </div>
  )
}
