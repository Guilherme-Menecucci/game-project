import { useNavigate } from 'react-router'
import styles from './GameOverScreen.module.css'

interface GameOverStats {
  elapsedMs: number
  kills: number
  level: number
  xp: number
}

interface GameOverScreenProps {
  stats: GameOverStats
  onRetry: () => void
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
  const ss = String(totalSec % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export function GameOverScreen({ stats, onRetry }: GameOverScreenProps) {
  const navigate = useNavigate()

  function handleExit() {
    void navigate('/')
  }

  return (
    <div className={styles.backdrop}>
      <div className={styles.card}>
        <h2 className={styles.heading}>Game Over</h2>

        <dl className={styles.stats}>
          <div className={styles.statRow}>
            <dt className={styles.statLabel}>Time Survived</dt>
            <dd className={styles.statValue}>{formatTime(stats.elapsedMs)}</dd>
          </div>
          <div className={styles.statRow}>
            <dt className={styles.statLabel}>Enemies Killed</dt>
            <dd className={styles.statValue}>{stats.kills}</dd>
          </div>
          <div className={styles.statRow}>
            <dt className={styles.statLabel}>Level Reached</dt>
            <dd className={styles.statValue}>{stats.level}</dd>
          </div>
          <div className={styles.statRow}>
            <dt className={styles.statLabel}>XP Earned</dt>
            <dd className={styles.statValue}>{stats.xp}</dd>
          </div>
        </dl>

        <button className={styles.retryBtn} type="button" onClick={onRetry}>
          Try Again
        </button>

        <button className={styles.exitLink} type="button" onClick={handleExit}>
          Exit to Home
        </button>
      </div>
    </div>
  )
}
