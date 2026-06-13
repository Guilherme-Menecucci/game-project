import { useState, useEffect } from 'react'
import styles from './HudXpBar.module.css'

interface HudXpBarProps {
  xp: number
  threshold: number
  level: number
}

export function HudXpBar({ xp, threshold, level }: HudXpBarProps) {
  const [flashing, setFlashing] = useState(false)
  const [prevLevel, setPrevLevel] = useState(level)

  useEffect(() => {
    if (level !== prevLevel) {
      setFlashing(true)
      setPrevLevel(level)
      const timer = setTimeout(() => setFlashing(false), 600)
      return () => clearTimeout(timer)
    }
  }, [level, prevLevel])

  const fillWidth = threshold > 0 ? (xp / threshold) * 120 : 0

  return (
    <div className={styles.cluster}>
      <span className={`${styles.badge} ${flashing ? styles.badgeFlash : ''}`}>Lv {level}</span>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: fillWidth }} />
      </div>
    </div>
  )
}
