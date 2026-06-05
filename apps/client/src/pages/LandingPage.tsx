import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../components/auth/AuthProvider.js'
import { AuthLayout } from '../components/auth/AuthLayout.js'
import { AuthButton } from '../components/auth/AuthButton.js'
import { TextLink } from '../components/auth/TextLink.js'
import styles from './LandingPage.module.css'

export function LandingPage() {
  const { user, loading, refresh } = useAuth()
  const navigate = useNavigate()
  const [guestLoading, setGuestLoading] = useState(false)
  const [guestError, setGuestError] = useState<string | null>(null)

  // If user is already registered, redirect to /game
  useEffect(() => {
    if (!loading && user !== null && !user.isGuest) {
      void navigate('/game', { replace: true })
    }
  }, [user, loading, navigate])

  async function handlePlayAsGuest() {
    setGuestLoading(true)
    setGuestError(null)
    try {
      const res = await fetch('/api/auth/guest', {
        method: 'POST',
        credentials: 'include',
      })
      if (res.ok) {
        await refresh()
        await navigate('/game')
      } else {
        setGuestError('Something went wrong on our end. Please try again.')
      }
    } catch {
      setGuestError('Something went wrong on our end. Please try again.')
    } finally {
      setGuestLoading(false)
    }
  }

  // Show nothing while checking auth state to avoid flash
  if (loading) return null

  return (
    <AuthLayout>
      <div className={styles.hero}>
        <h1 className={styles.title}>GUNPOWDER</h1>
        <div className={styles.actions}>
          <AuthButton
            loading={guestLoading}
            loadingLabel="Loading…"
            onClick={() => void handlePlayAsGuest()}
            type="button"
          >
            Play as Guest
          </AuthButton>
          {guestError && <p className={styles.guestError}>{guestError}</p>}
          <p className={styles.subLabel}>No account needed — jump in instantly</p>
          <div className={styles.links}>
            <TextLink to="/login">Sign In</TextLink>
            <TextLink to="/register">Create Account</TextLink>
          </div>
        </div>
      </div>
    </AuthLayout>
  )
}
