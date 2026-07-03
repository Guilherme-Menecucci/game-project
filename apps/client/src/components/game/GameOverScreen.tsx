import { useNavigate } from 'react-router'
import { Canvas } from '@react-three/fiber'
import { SummaryPanel } from '../ui/SummaryPanel.js'
import { BuildPanel } from '../ui/BuildPanel.js'
import styles from './GameOverScreen.module.css'

interface GameOverStats {
  elapsedMs: number
  kills: number
  level: number
  xp: number
  weapons?: string[]
  passives?: string[]
  /** Mirrors GameStateSchema.result — 'survived' | 'defeated' | '' (D-20). */
  result?: string
  /** Keyed by slot index '0'-'5' (D-21). */
  weaponStats?: Record<string, { totalDamage: number; acquiredAtMs: number }>
}

interface GameOverScreenProps {
  stats: GameOverStats
  onRetry: () => void
}

/**
 * End-of-run summary — R3F Canvas-above-Phaser overlay (D-22), reusing
 * UpgradePicker's backdrop+Canvas z-index 50/51 pattern. Two mesh panels:
 * SummaryPanel (time/kills/damage/result) and BuildPanel (loadout grid +
 * per-weapon Total Damage/DPS). Action buttons stay as fixed DOM siblings
 * of the Canvas so they are always clickable regardless of camera/Html quirks.
 */
export function GameOverScreen({ stats, onRetry }: GameOverScreenProps) {
  const navigate = useNavigate()

  function handleExit() {
    void navigate('/')
  }

  // Client-derived aggregate: no server-side damageDealt field exists (D-21) —
  // summing weaponStats is the only available source and matches D-21's scoping
  // (weapon damage only, passives excluded).
  const totalDamage = Object.values(stats.weaponStats ?? {}).reduce(
    (sum, s) => sum + s.totalDamage,
    0
  )

  const result = (
    stats.result === 'survived' || stats.result === 'defeated' ? stats.result : ''
  ) as 'survived' | 'defeated' | ''

  return (
    <>
      {/* Semi-transparent dark backdrop overlay covering Phaser (z-index 50) */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(5, 5, 15, 0.85)',
          zIndex: 50,
          pointerEvents: 'all',
          backdropFilter: 'blur(5px)',
        }}
      />

      {/* R3F Canvas container overlay positioned above backdrop (z-index 51) */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 51,
          pointerEvents: 'none',
        }}
      >
        <Canvas
          camera={{ position: [0, 0, 5], fov: 50 }}
          style={{
            width: '100%',
            height: '100%',
            pointerEvents: 'auto',
          }}
        >
          <ambientLight intensity={0.8} />
          <directionalLight position={[2, 4, 6]} intensity={1.0} />

          <SummaryPanel
            position={[-1.8, 0, 0]}
            elapsedMs={stats.elapsedMs}
            kills={stats.kills}
            totalDamage={totalDamage}
            result={result}
          />
          <BuildPanel
            position={[1.0, 0, 0]}
            weapons={stats.weapons ?? []}
            passives={stats.passives ?? []}
            weaponStats={stats.weaponStats ?? {}}
            elapsedMs={stats.elapsedMs}
          />
        </Canvas>
      </div>

      {/* Action buttons — fixed DOM above the Canvas, always clickable */}
      <div className={styles.actions}>
        <button className={styles.retryBtn} type="button" onClick={onRetry}>
          Try Again
        </button>
        <button className={styles.exitLink} type="button" onClick={handleExit}>
          Exit to Home
        </button>
      </div>
    </>
  )
}
