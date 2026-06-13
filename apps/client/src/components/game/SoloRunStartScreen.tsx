import { useNavigate } from 'react-router'
import type { AuthUser } from '../auth/AuthProvider.js'
import { LogoutButton } from '../auth/LogoutButton.js'
import type { GameError, GamePhase } from '../../pages/GamePage.js'
import styles from './SoloRunStartScreen.module.css'

interface SoloRunStartScreenProps {
  phase: Extract<GamePhase, 'IDLE' | 'CONNECTING'>
  error: GameError
  user: AuthUser
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

export function SoloRunStartScreen({ phase, error, user, onSoloRun }: SoloRunStartScreenProps) {
  const isConnecting = phase === 'CONNECTING'

  const displayName = user?.isGuest ? user.displayName : user ? `${user.userId.slice(0, 8)}…` : ''

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
