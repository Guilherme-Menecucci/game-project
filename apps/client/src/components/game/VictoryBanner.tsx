import { useState, useEffect } from 'react'
import styles from './VictoryBanner.module.css'

interface VictoryBannerProps {
  visible: boolean
}

/**
 * One-time, non-modal victory banner (GAME-16, D-20).
 *
 * Parent latches `visible` true when the final boss is defeated (it never
 * resets — the final boss cannot reappear); the banner self-dismisses after
 * 4s (no button). The full entrance/exit animation lives in a single 4s CSS
 * keyframe, so no JS-timed class swaps are needed. pointer-events: none —
 * never blocks input.
 */
export function VictoryBanner({ visible }: VictoryBannerProps) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (visible) {
      setShow(true)
      const timer = setTimeout(() => setShow(false), 4000)
      return () => clearTimeout(timer)
    }
  }, [visible])

  if (!show) {
    return null
  }

  return (
    <div className={styles.banner}>
      <div className={styles.headline}>VICTORY!</div>
      <div className={styles.subtext}>
        The Unfinished One has fallen. The run continues — survive as long as you can.
      </div>
    </div>
  )
}
