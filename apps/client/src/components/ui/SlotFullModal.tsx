import type { FC } from 'react'
import styles from './SlotFullModal.module.css'

interface SlotFullModalProps {
  weapons: string[]
  upgradeId: string
  onReplace: (slot: number) => void
}

const WEAPON_NAMES: Record<string, string> = {
  magic_wand: 'Magic Wand',
  garlic: 'Garlic',
  knife: 'Knife',
  bible: 'King Bible',
  holy_wand: 'Holy Wand',
  thousand_edge: 'Thousand Edge',
}

export const SlotFullModal: FC<SlotFullModalProps> = ({ weapons, upgradeId, onReplace }) => {
  const newWeaponName = WEAPON_NAMES[upgradeId] || upgradeId.replace('_', ' ').toUpperCase()

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>WEAPON SLOTS FULL!</div>
        <div className={styles.subtitle}>
          Select a slot to discard and replace with{' '}
          <span className={styles.highlight}>{newWeaponName}</span>:
        </div>

        <div className={styles.grid}>
          {weapons.map((weaponId, index) => {
            const name = WEAPON_NAMES[weaponId] || weaponId.replace('_', ' ').toUpperCase()
            return (
              <button key={index} className={styles.card} onClick={() => onReplace(index)}>
                <div className={styles.slotNum}>Slot {index + 1}</div>
                <div className={styles.weaponName}>{name}</div>
                <div className={styles.discardLabel}>DISCARD & REPLACE</div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
