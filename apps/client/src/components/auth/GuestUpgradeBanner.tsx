import { useAuth } from './AuthProvider.js'
import styles from './GuestUpgradeBanner.module.css'

export function GuestUpgradeBanner() {
  const { user } = useAuth()

  if (!user || !user.isGuest) return null

  return (
    <div className={styles.banner}>
      You&apos;re currently playing as a guest. Create an account to keep your session.
    </div>
  )
}
