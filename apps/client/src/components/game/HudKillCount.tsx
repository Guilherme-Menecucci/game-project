import styles from './HudKillCount.module.css'

interface HudKillCountProps {
  kills: number
}

export function HudKillCount({ kills }: HudKillCountProps) {
  return <span className={styles.text}>{kills} enemies slain</span>
}
