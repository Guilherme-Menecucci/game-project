import { Navigate, useLocation } from 'react-router'
import { useAuth } from './AuthProvider.js'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  // While loading: render null to avoid flash
  if (loading) return null

  // Unauthenticated: redirect to /login with ?redirect= param for post-login redirect
  if (user === null) {
    const redirectTo = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?redirect=${redirectTo}`} replace />
  }

  // Guest users pass through (guests can access /game in Phase 2)
  // Registered users pass through
  return <>{children}</>
}
