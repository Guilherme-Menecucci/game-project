import styles from './HudTimer.module.css'

interface HudTimerProps {
  elapsedMs: number
}

export function HudTimer({ elapsedMs }: HudTimerProps) {
  const totalSec = Math.floor(elapsedMs / 1000)
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
  const ss = String(totalSec % 60).padStart(2, '0')

  return (
    <span className={styles.timer}>
      {mm}:{ss}
    </span>
  )
}
