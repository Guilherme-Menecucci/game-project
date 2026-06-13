import { createContext, useContext, useEffect, useState } from 'react'

export type AuthUser =
  | null
  | { userId: string; isGuest: true; displayName: string }
  | { userId: string; isGuest: false }

export interface AuthContextValue {
  user: AuthUser
  loading: boolean
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue>(null!)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>')
  }
  return ctx
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser>(null)
  const [loading, setLoading] = useState(true)

  async function fetchMe(): Promise<void> {
    setLoading(true)
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' })
      if (res.ok) {
        const data = (await res.json()) as AuthUser
        setUser(data)
      } else {
        // 401 or any non-2xx → unauthenticated
        setUser(null)
      }
    } catch {
      // Network error or 5xx — do not block the UI
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  // React 19 Strict Mode will double-invoke this effect in dev — this is expected
  // behavior (RESEARCH Pitfall 4). Do NOT add deduplication logic.
  // Empty dep array is intentional: run once on mount to check session state.
  useEffect(() => {
    void fetchMe()
  }, [])

  async function refresh(): Promise<void> {
    await fetchMe()
  }

  return <AuthContext.Provider value={{ user, loading, refresh }}>{children}</AuthContext.Provider>
}
