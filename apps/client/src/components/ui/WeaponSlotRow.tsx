import type { FC } from 'react'
import styles from './WeaponSlotRow.module.css'

interface WeaponSlotRowProps {
  weapons: string[]
  passives: string[]
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

const PASSIVE_ABBRS: Record<string, string> = {
  spinach: 'SPN',
  boots: 'BTS',
  empty_tome: 'TOM',
  bracer: 'BRC',
}

export const WeaponSlotRow: FC<WeaponSlotRowProps> = ({ weapons, passives, maxSlots = 6 }) => {
  const slots = Array.from({ length: maxSlots })

  const weaponCount = weapons.length
  const passiveCount = passives.length

  return (
    <div className={styles.container}>
      {/* Weapons Section */}
      <div className={styles.section}>
        <div className={styles.labelRow}>
          <span className={styles.labelText}>Weapons</span>
          <span className={styles.countText}>
            {weaponCount}/{maxSlots}
          </span>
        </div>
        <div className={styles.slotsRow}>
          {slots.map((_, i) => {
            const rawWeaponId = weapons[i]
            const isFilled = rawWeaponId !== undefined
            const [weaponId, levelStr] = isFilled ? rawWeaponId.split(':') : ['', '']
            const level = levelStr ? parseInt(levelStr, 10) : 1
            const abbr = isFilled
              ? WEAPON_ABBRS[weaponId] || weaponId.substring(0, 3).toUpperCase()
              : ''
            const isEvolvable =
              isFilled &&
              (weaponId === 'magic_wand' || weaponId === 'knife') &&
              ((weaponId === 'magic_wand' && passives.some((p) => p.startsWith('empty_tome'))) ||
                (weaponId === 'knife' && passives.some((p) => p.startsWith('bracer'))))

            return (
              <div
                key={`weapon-${i}`}
                className={`${styles.slot} ${styles.weaponSlot} ${isFilled ? styles.filled : styles.empty} ${isEvolvable ? styles.evolvable : ''}`}
                title={rawWeaponId || 'Empty Slot'}
              >
                {isFilled && (
                  <div
                    className={styles.indicator}
                    style={{
                      backgroundColor:
                        weaponId === 'holy_wand' || weaponId === 'thousand_edge'
                          ? 'var(--color-upgrade-evolution)'
                          : 'var(--color-upgrade-weapon)',
                      color:
                        weaponId === 'holy_wand' || weaponId === 'thousand_edge'
                          ? '#1a1a2e'
                          : '#ffffff',
                    }}
                  >
                    {abbr}
                    {levelStr && <span className={styles.levelBadge}>L{level}</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Divider */}
      <div className={styles.divider} />

      {/* Passives Section */}
      <div className={styles.section}>
        <div className={styles.labelRow}>
          <span className={styles.labelText}>Passives</span>
          <span className={styles.countText}>
            {passiveCount}/{maxSlots}
          </span>
        </div>
        <div className={styles.slotsRow}>
          {slots.map((_, i) => {
            const rawPassiveId = passives[i]
            const isFilled = rawPassiveId !== undefined
            const [passiveId, levelStr] = isFilled ? rawPassiveId.split(':') : ['', '']
            const level = levelStr ? parseInt(levelStr, 10) : 1
            const abbr = isFilled
              ? PASSIVE_ABBRS[passiveId] || passiveId.substring(0, 3).toUpperCase()
              : ''

            return (
              <div
                key={`passive-${i}`}
                className={`${styles.slot} ${styles.passiveSlot} ${isFilled ? styles.filled : styles.empty}`}
                title={rawPassiveId || 'Empty Slot'}
              >
                {isFilled && (
                  <div
                    className={styles.indicator}
                    style={{
                      backgroundColor: 'var(--color-upgrade-passive)',
                      color: '#ffffff',
                    }}
                  >
                    {abbr}
                    {levelStr && <span className={styles.levelBadge}>L{level}</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
