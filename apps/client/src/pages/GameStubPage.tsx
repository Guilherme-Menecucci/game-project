import { useAuth } from '../components/auth/AuthProvider.js'
import { LogoutButton } from '../components/auth/LogoutButton.js'
import styles from './GameStubPage.module.css'

export function GameStubPage() {
  const { user } = useAuth()

  const displayName = user?.isGuest
    ? user.displayName
    : user
      ? `Welcome back (${user.userId.slice(0, 8)}…)`
      : ''

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <h1 className={styles.name}>{displayName}</h1>
        <p className={styles.placeholder}>Game coming in Phase 3 — you&apos;re authenticated!</p>
        <LogoutButton />
      </div>
    </div>
  )
}
