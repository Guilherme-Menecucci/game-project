import styles from './HudBossBar.module.css'

interface HudBossBarProps {
  name: string
  hp: number
  maxHp: number
}

export function HudBossBar({ name, hp, maxHp }: HudBossBarProps) {
  const ratio = maxHp > 0 ? hp / maxHp : 0
  const fillWidth = ratio * 320

  return (
    <div className={styles.cluster}>
      <span className={styles.label}>{name}</span>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: fillWidth }} />
      </div>
    </div>
  )
}
