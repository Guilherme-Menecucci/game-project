import styles from './HudTeammates.module.css'

export interface TeammateStatus {
  sessionId: string
  displayName: string
  hp: number
  maxHp: number
  downed: boolean
  bleedOutRemainingMs: number
  eliminated: boolean
}

interface HudTeammatesProps {
  teammates: TeammateStatus[]
}

/**
 * Format a bleed-out countdown as m:ss. Uses ceil so the clock reads 0:30 at
 * the moment of going down and never sits on 0:00 while the player still lives.
 */
export function formatBleedOut(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Co-op teammate status cluster (UI-SPEC §6) — sibling-component pattern like
 * HudHpBar: props in, no room access. One row per teammate: name + 120×6 HP bar.
 * Downed → amber bar, "⛑" prefix, live bleed-out countdown. Eliminated → row at
 * 40% opacity with the name struck through. All strings render as React text
 * children (auto-escaped, T-06-21).
 */
export function HudTeammates({ teammates }: HudTeammatesProps) {
  if (teammates.length === 0) {
    return null
  }

  return (
    <div className={styles.cluster}>
      {teammates.map((t) => {
        const ratio = t.maxHp > 0 ? Math.max(0, Math.min(1, t.hp / t.maxHp)) : 0
        // Downed players sit at 0 hp — show a full amber bar so the state reads
        // at a glance (the countdown carries the urgency).
        const fillWidth = t.downed ? 120 : ratio * 120
        const rowClass = t.eliminated ? `${styles.row} ${styles.eliminated}` : styles.row
        const fillClass = t.downed ? `${styles.fill} ${styles.fillDowned}` : styles.fill

        return (
          <div key={t.sessionId} className={rowClass}>
            <div className={styles.nameLine}>
              <span className={styles.name}>{t.downed ? `⛑ ${t.displayName}` : t.displayName}</span>
              {t.downed && (
                <span className={styles.countdown}>{formatBleedOut(t.bleedOutRemainingMs)}</span>
              )}
            </div>
            <div className={styles.track}>
              <div className={fillClass} style={{ width: fillWidth }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
