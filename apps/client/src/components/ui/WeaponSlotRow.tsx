import type { FC } from 'react'
import styles from './WeaponSlotRow.module.css'

interface WeaponSlotRowProps {
  weapons: string[]
  maxSlots?: number
}

const WEAPON_ABBRS: Record<string, string> = {
  magic_wand: 'WND',
  garlic: 'GRL',
  knife: 'KNF',
  bible: 'BBL',
  holy_wand: 'HLY',
  thousand_edge: 'EDG',
}

export const WeaponSlotRow: FC<WeaponSlotRowProps> = ({ weapons, maxSlots = 6 }) => {
  const slots = Array.from({ length: maxSlots })

  return (
    <div className={styles.row}>
      {slots.map((_, i) => {
        const weaponId = weapons[i]
        const isFilled = weaponId !== undefined
        const abbr = isFilled
          ? WEAPON_ABBRS[weaponId] || weaponId.substring(0, 3).toUpperCase()
          : ''

        return (
          <div
            key={i}
            className={`${styles.slot} ${isFilled ? styles.filled : styles.empty}`}
            title={weaponId || 'Empty Slot'}
          >
            {isFilled && (
              <div
                className={styles.indicator}
                style={{
                  backgroundColor:
                    weaponId === 'holy_wand' || weaponId === 'thousand_edge'
                      ? 'var(--color-upgrade-evolution)'
                      : 'var(--color-upgrade-weapon)',
                }}
              >
                {abbr}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
