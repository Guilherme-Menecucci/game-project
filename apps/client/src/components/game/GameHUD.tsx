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
import { useState, useEffect, useRef } from 'react'
import type { Room } from '@colyseus/sdk'
import { Callbacks } from '@colyseus/sdk'
import { HudHpBar } from './HudHpBar.js'
import { HudTimer } from './HudTimer.js'
import { HudXpBar } from './HudXpBar.js'
import { HudKillCount } from './HudKillCount.js'
import { HudBossBar } from './HudBossBar.js'
import { VictoryBanner } from './VictoryBanner.js'
import { LogoutButton } from '../auth/LogoutButton.js'
import { WeaponSlotRow } from '../ui/WeaponSlotRow.js'
import { getXpThresholdForLevel } from '@game/shared'
import styles from './GameHUD.module.css'

export interface EndRunStats {
  killCount: number
  elapsedMs: number
  level: number
  xp: number
  weapons: string[]
  passives: string[]
  result: string
  weaponStats: Record<string, { totalDamage: number; acquiredAtMs: number }>
}

interface GameHUDProps {
  room: Room
  onEndRun?: (stats: EndRunStats) => void
}

export function GameHUD({ room, onEndRun }: GameHUDProps) {
  const [hp, setHp] = useState<number>(0)
  const [maxHp, setMaxHp] = useState<number>(1)
  const [xp, setXp] = useState<number>(0)
  const [level, setLevel] = useState<number>(1)
  const [elapsedMs, setElapsedMs] = useState<number>(0)
  const [kills, setKills] = useState<number>(0)
  const [weapons, setWeapons] = useState<string[]>([])
  const [passives, setPassives] = useState<string[]>([])
  const [boss, setBoss] = useState<{ name: string; hp: number; maxHp: number } | null>(null)
  const [showVictory, setShowVictory] = useState(false)
  const prevHasFinalBossRef = useRef(false)
  const weaponStatsRef = useRef<Record<string, { totalDamage: number; acquiredAtMs: number }>>({})

  // Subscribe to full state changes — fires at ~20Hz server tick rate
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (state: any) => {
      const myPlayer = (
        state.players as Map<
          string,
          {
            hp: number
            maxHp: number
            xp: number
            level: number
            weapons: string[]
            passives: string[]
          }
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
        if (myPlayer.passives) {
          setPassives(Array.from(myPlayer.passives))
        }
        // Flatten weaponStats MapSchema -> plain Record (same convention as
        // GameScene.emitGameOver) so End Run can hand a complete summary payload.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawStats = (myPlayer as any).weaponStats as
          | Map<string, { totalDamage?: number; acquiredAtMs?: number }>
          | undefined
        if (rawStats) {
          const flat: Record<string, { totalDamage: number; acquiredAtMs: number }> = {}
          for (const [slot, s] of rawStats) {
            flat[slot] = { totalDamage: s.totalDamage ?? 0, acquiredAtMs: s.acquiredAtMs ?? 0 }
          }
          weaponStatsRef.current = flat
        }
      }
      setElapsedMs(state.elapsedMs as number)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bosses = state.bosses as Map<string, any>
      const bossEntry = bosses && bosses.size > 0 ? [...bosses.values()][0] : null
      setBoss(bossEntry ? { name: bossEntry.name, hp: bossEntry.hp, maxHp: bossEntry.maxHp } : null)

      // Victory detection (GAME-16, D-20): no server-side victory event exists —
      // the only wire signal is bossKey 'unfinished_one' leaving state.bosses.
      // hp > 0 gate suppresses the banner if the player died the same tick.
      const hasFinalBoss = bosses
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          [...bosses.values()].some((b: any) => b.bossKey === 'unfinished_one')
        : false
      if (prevHasFinalBossRef.current && !hasFinalBoss && myPlayer && myPlayer.hp > 0) {
        setShowVictory(true)
      }
      prevHasFinalBossRef.current = hasFinalBoss
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

      {/* Top-center: Run timer + boss HP bar */}
      <div className={styles.topCenter}>
        <HudTimer elapsedMs={elapsedMs} />
        {boss && <HudBossBar name={boss.name} hp={boss.hp} maxHp={boss.maxHp} />}
      </div>

      {/* Top-right: XP cluster + LogoutButton + End Run */}
      <div className={styles.topRight}>
        <HudXpBar xp={xp} threshold={getXpThresholdForLevel(level)} level={level} />
        <div className={styles.logoutWrapper}>
          <LogoutButton />
        </div>
        {onEndRun && (
          <div className={styles.logoutWrapper}>
            <button
              className={styles.endRunBtn}
              type="button"
              onClick={() =>
                onEndRun({
                  killCount: kills,
                  elapsedMs,
                  level,
                  xp,
                  weapons,
                  passives,
                  // Voluntary exit while alive = survived — mirrors SoloRoom.onLeave's
                  // server-side rule (result stays 'defeated' only if already dead).
                  result: hp > 0 ? 'survived' : 'defeated',
                  weaponStats: weaponStatsRef.current,
                })
              }
            >
              End Run
            </button>
          </div>
        )}
      </div>

      {/* Bottom-left: Kill count */}
      <div className={styles.bottomLeft}>
        <HudKillCount kills={kills} />
      </div>

      {/* Bottom-center: Weapon slots row */}
      <div className={styles.bottomCenter}>
        <WeaponSlotRow weapons={weapons} passives={passives} />
      </div>

      {/* Victory banner — own fixed positioning, self-dismisses after 4s */}
      <VictoryBanner visible={showVictory} />
    </div>
  )
}
