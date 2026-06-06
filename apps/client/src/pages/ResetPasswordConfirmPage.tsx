import { useState } from 'react'
import { useParams } from 'react-router'
import { AuthLayout } from '../components/auth/AuthLayout.js'
import { AuthCard } from '../components/auth/AuthCard.js'
import { AuthInput } from '../components/auth/AuthInput.js'
import { AuthButton } from '../components/auth/AuthButton.js'
import { FormError } from '../components/auth/FormError.js'
import { TextLink } from '../components/auth/TextLink.js'
import styles from './ResetPasswordConfirmPage.module.css'

type PageState = 'form' | 'success' | 'expired'

export function ResetPasswordConfirmPage() {
  const { token } = useParams<{ token: string }>()

  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [pageState, setPageState] = useState<PageState>('form')

  function validatePassword(pw: string): string | null {
    if (pw.length < 8) return 'Password must be at least 8 characters.'
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const passErr = validatePassword(password)
    if (passErr) {
      setPasswordError(passErr)
      return
    }
    setPasswordError(null)

    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, password }),
      })

      if (res.ok) {
        setPageState('success')
      } else if (res.status === 400 || res.status === 404 || res.status === 410) {
        // Token invalid, expired, or already used
        setPageState('expired')
      } else {
        setFormError('Something went wrong on our end. Please try again.')
      }
    } catch {
      setFormError('Something went wrong on our end. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (pageState === 'success') {
    return (
      <AuthLayout>
        <AuthCard heading="Password updated">
          <p className={styles.body}>
            Your password has been changed. You can now sign in with your new password.
          </p>
          <TextLink to="/login">Sign in</TextLink>
        </AuthCard>
      </AuthLayout>
    )
  }

  if (pageState === 'expired') {
    return (
      <AuthLayout>
        <AuthCard heading="Link expired or invalid">
          <p className={styles.body}>
            This reset link is no longer valid. Reset links expire after 15 minutes and can only be
            used once.
          </p>
          <TextLink to="/reset-password">Request a new link</TextLink>
        </AuthCard>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <AuthCard heading="Set New Password">
        <form onSubmit={(e) => void handleSubmit(e)} noValidate>
          <div className={styles.fields}>
            <AuthInput
              label="New Password"
              type="password"
              name="password"
              placeholder="••••••••"
              helperText="At least 8 characters"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (passwordError) setPasswordError(null)
              }}
              error={passwordError ?? undefined}
            />
            <FormError error={formError} />
            <AuthButton loading={loading} loadingLabel="Saving…">
              Set New Password
            </AuthButton>
          </div>
        </form>
      </AuthCard>
    </AuthLayout>
  )
}
