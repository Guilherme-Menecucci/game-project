import styles from './HudHpBar.module.css'

interface HudHpBarProps {
  hp: number
  maxHp: number
}

export function HudHpBar({ hp, maxHp }: HudHpBarProps) {
  const ratio = maxHp > 0 ? hp / maxHp : 0
  const fillWidth = ratio * 160

  let fillClass = styles.fillHigh
  if (ratio <= 0.25) {
    fillClass = styles.fillCritical
  } else if (ratio <= 0.5) {
    fillClass = styles.fillMid
  }

  return (
    <div className={styles.cluster}>
      <span className={styles.label}>HP</span>
      <div className={styles.track}>
        <div className={`${styles.fill} ${fillClass}`} style={{ width: fillWidth }} />
      </div>
      <span className={styles.value}>
        {hp} / {maxHp}
      </span>
    </div>
  )
}
