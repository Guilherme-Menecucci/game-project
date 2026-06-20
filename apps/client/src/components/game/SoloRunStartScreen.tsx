import { useNavigate } from 'react-router'
import type { AuthUser } from '../auth/AuthProvider.js'
import { LogoutButton } from '../auth/LogoutButton.js'
import type { GameError, GamePhase } from '../../pages/GamePage.js'
import { characterCatalog, weaponCatalog } from '@game/shared'
import styles from './SoloRunStartScreen.module.css'

type ClassId = 'vampire' | 'human' | 'dwarf'
type WeaponId = 'magic_wand' | 'garlic' | 'knife' | 'bible'

// Pre-created loadouts (superseding D-03/D-06's independent class+weapon
// pickers per user feedback on plan 05-09's checkpoint): each class maps to
// exactly ONE fixed starting weapon. Garlic is intentionally NOT a starting
// loadout option — it remains an in-run pickup/upgrade only.
export const CLASS_WEAPON: Record<ClassId, WeaponId> = {
  vampire: 'magic_wand',
  human: 'knife',
  dwarf: 'bible',
}

// Fixed display order per D-02/05-UI-SPEC.md Component Inventory item 1
const CLASS_ORDER: ClassId[] = ['vampire', 'human', 'dwarf']

function statSummaryFor(classId: ClassId): string {
  const entry = characterCatalog[classId]
  const human = characterCatalog.human
  if (classId === 'human') {
    return 'All stats baseline (×1.0)'
  }
  const dmgPct = Math.round((entry.damageMultiplier - 1) * 100)
  const ratePct = Math.round((entry.fireRateMultiplier - 1) * 100)
  const hpPct = Math.round((entry.baseMaxHp / human.baseMaxHp - 1) * 100)
  const speedPct = Math.round((entry.baseSpeed / human.baseSpeed - 1) * 100)
  const signed = (n: number) => (n >= 0 ? `+${n}%` : `${n}%`)
  return `${signed(dmgPct)} damage, ${signed(ratePct)} fire rate, ${signed(hpPct)} max HP, ${signed(speedPct)} speed`
}

interface SoloRunStartScreenProps {
  phase: Extract<GamePhase, 'IDLE' | 'CHARACTER_SELECT' | 'CONNECTING'>
  error: GameError
  user: AuthUser
  selectedClassId: ClassId | null
  onSelectClass: (classId: ClassId) => void
  onSoloRun: () => void
}

function ErrorBanner({ error, onRetry }: { error: GameError; onRetry: () => void }) {
  const navigate = useNavigate()

  if (!error) return null

  if (error === 'SESSION_EXPIRED') {
    return (
      <div className={styles.errorBanner} role="alert">
        <p className={styles.errorText}>Your session expired. Sign in again to play.</p>
        <button
          className={styles.errorActionBtn}
          type="button"
          onClick={() => void navigate('/login')}
        >
          Sign In
        </button>
      </div>
    )
  }

  if (error === 'TOKEN_REJECTED') {
    return (
      <div className={styles.errorBanner} role="alert">
        <p className={styles.errorText}>Connection rejected. Return to home.</p>
        <button className={styles.errorActionBtn} type="button" onClick={() => void navigate('/')}>
          Return Home
        </button>
      </div>
    )
  }

  if (error === 'GAME_SERVER_UNREACHABLE') {
    return (
      <div className={styles.errorBanner} role="alert">
        <p className={styles.errorText}>Game server is unreachable. Try again.</p>
        <button className={styles.errorActionBtn} type="button" onClick={onRetry}>
          Try Again
        </button>
      </div>
    )
  }

  // SERVER_ERROR
  return (
    <div className={styles.errorBanner} role="alert">
      <p className={styles.errorText}>Couldn&apos;t reach the server. Try again.</p>
      <button className={styles.errorActionBtn} type="button" onClick={onRetry}>
        Try Again
      </button>
    </div>
  )
}

export function SoloRunStartScreen({
  phase,
  error,
  user,
  selectedClassId,
  onSelectClass,
  onSoloRun,
}: SoloRunStartScreenProps) {
  const isConnecting = phase === 'CONNECTING'
  const isCharacterSelect = phase === 'CHARACTER_SELECT' || phase === 'CONNECTING'
  const canStart = !!selectedClassId && !isConnecting

  const displayName = user?.isGuest ? user.displayName : user ? `${user.userId.slice(0, 8)}…` : ''

  if (isCharacterSelect) {
    const selectedEntry = selectedClassId ? characterCatalog[selectedClassId] : null

    return (
      <div className={styles.screen}>
        <div className={styles.loadoutLayout}>
          {error && <ErrorBanner error={error} onRetry={onSoloRun} />}

          <h1 className={styles.heading}>Choose Your Survivor</h1>

          {user && (
            <p className={styles.userLabel}>
              Playing as <span className={styles.userName}>{displayName}</span>
            </p>
          )}

          <div className={styles.loadoutCardRow}>
            {CLASS_ORDER.map((classId) => {
              const entry = characterCatalog[classId]
              const weaponEntry = weaponCatalog[CLASS_WEAPON[classId]]
              const isSelected = selectedClassId === classId
              return (
                <button
                  key={classId}
                  type="button"
                  className={`${styles.loadoutCard} ${isSelected ? styles.loadoutCardSelected : ''}`}
                  onClick={() => onSelectClass(classId)}
                >
                  <p className={styles.classCardName}>{entry.displayName}</p>
                  <p className={styles.loadoutWeaponName}>{weaponEntry.displayName}</p>
                </button>
              )
            })}
          </div>

          <div className={styles.detailsPanel}>
            {selectedEntry ? (
              <>
                <p className={styles.classCardFlavor}>{selectedEntry.description}</p>
                <p className={styles.classCardStats}>
                  {statSummaryFor(selectedEntry.classId)} — starts with{' '}
                  {weaponCatalog[CLASS_WEAPON[selectedEntry.classId]].displayName}
                </p>
              </>
            ) : (
              <p className={styles.detailsPlaceholder}>Select a loadout to see details</p>
            )}
          </div>

          <div className={styles.startRunWrapper}>
            <button
              className={styles.soloRunBtn}
              type="button"
              disabled={!canStart}
              onClick={onSoloRun}
            >
              {isConnecting ? 'Connecting…' : 'Start Run'}
            </button>
          </div>

          <div className={styles.logoutWrapper}>
            <LogoutButton />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <h1 className={styles.heading}>Solo Run</h1>
        <p className={styles.subCopy}>Survive as long as you can.</p>

        {user && (
          <p className={styles.userLabel}>
            Playing as <span className={styles.userName}>{displayName}</span>
          </p>
        )}

        {error && <ErrorBanner error={error} onRetry={onSoloRun} />}

        {!error && (
          <button
            className={styles.soloRunBtn}
            type="button"
            disabled={isConnecting}
            onClick={onSoloRun}
          >
            {isConnecting ? 'Connecting…' : 'Solo Run'}
          </button>
        )}

        {error && !isConnecting && (
          <button
            className={styles.soloRunBtn}
            type="button"
            disabled={isConnecting}
            onClick={onSoloRun}
          >
            Solo Run
          </button>
        )}

        <div className={styles.logoutWrapper}>
          <LogoutButton />
        </div>
      </div>
    </div>
  )
}
