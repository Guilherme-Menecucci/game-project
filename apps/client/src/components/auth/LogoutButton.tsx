import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from './AuthProvider.js'
import styles from './LogoutButton.module.css'

export function LogoutButton() {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogout() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
      if (res.ok) {
        await refresh()
        await navigate('/')
      } else {
        setError("Couldn't log out. Try again.")
      }
    } catch {
      setError("Couldn't log out. Try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.wrapper}>
      <button
        className={styles.btn}
        type="button"
        disabled={loading}
        onClick={() => void handleLogout()}
      >
        {loading ? 'Logging out…' : 'Log Out'}
      </button>
      {error && <span className={styles.error}>{error}</span>}
    </div>
  )
}
