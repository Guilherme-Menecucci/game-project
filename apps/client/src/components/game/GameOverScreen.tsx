import { useNavigate } from 'react-router'
import styles from './GameOverScreen.module.css'

interface GameOverStats {
  elapsedMs: number
  kills: number
  level: number
  xp: number
  weapons?: string[]
  passives?: string[]
}

interface GameOverScreenProps {
  stats: GameOverStats
  onRetry: () => void
}

const ITEM_NAMES: Record<string, string> = {
  magic_wand: 'Magic Wand',
  garlic: 'Garlic',
  knife: 'Knife',
  bible: 'Bible',
  holy_wand: 'Holy Wand 🌟',
  thousand_edge: 'Thousand Edge 🌟',
  spinach: 'Spinach',
  boots: 'Boots',
  empty_tome: 'Empty Tome',
  bracer: 'Bracer',
}

const ITEM_ICONS: Record<string, string> = {
  magic_wand: '🪄',
  garlic: '🧄',
  knife: '🗡️',
  bible: '📖',
  holy_wand: '🌟',
  thousand_edge: '💫',
  spinach: '🌱',
  boots: '🥾',
  empty_tome: '📕',
  bracer: '🛡️',
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

        {/* Final Loadout Section */}
        {((stats.weapons && stats.weapons.length > 0) ||
          (stats.passives && stats.passives.length > 0)) && (
          <div className={styles.loadoutSection}>
            <h3 className={styles.loadoutHeading}>Final Loadout</h3>
            <div className={styles.loadoutRow}>
              {stats.weapons?.map((w, i) => {
                const [id, lvl] = w.split(':')
                const isEvolved = id === 'holy_wand' || id === 'thousand_edge'
                return (
                  <div
                    key={`weapon-${i}`}
                    className={styles.loadoutItem}
                    style={{
                      borderStyle: 'solid',
                      borderColor: isEvolved
                        ? 'var(--color-upgrade-evolution, #ffcc00)'
                        : 'var(--color-upgrade-weapon, #4a9eff)',
                    }}
                    title={ITEM_NAMES[id] || id}
                  >
                    <span className={styles.itemIcon}>{ITEM_ICONS[id] || '❓'}</span>
                    {lvl && <span className={styles.itemLvlBadge}>L{lvl}</span>}
                  </div>
                )
              })}
              {stats.passives?.map((p, i) => {
                const [id, lvl] = p.split(':')
                return (
                  <div
                    key={`passive-${i}`}
                    className={styles.loadoutItem}
                    style={{
                      borderStyle: 'solid',
                      borderColor: 'var(--color-upgrade-passive, #44cc88)',
                    }}
                    title={ITEM_NAMES[id] || id}
                  >
                    <span className={styles.itemIcon}>{ITEM_ICONS[id] || '❓'}</span>
                    {lvl && (
                      <span className={styles.itemLvlBadge} style={{ color: '#44cc88' }}>
                        L{lvl}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

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
