import { useState } from 'react'
import { useNavigate } from 'react-router'
import { RegisterSchema } from '@game/shared'
import { useAuth } from '../components/auth/AuthProvider.js'
import { AuthLayout } from '../components/auth/AuthLayout.js'
import { AuthCard } from '../components/auth/AuthCard.js'
import { AuthInput } from '../components/auth/AuthInput.js'
import { AuthButton } from '../components/auth/AuthButton.js'
import { FormError } from '../components/auth/FormError.js'
import { TextLink } from '../components/auth/TextLink.js'
import { GuestUpgradeBanner } from '../components/auth/GuestUpgradeBanner.js'
import styles from './RegisterPage.module.css'

function getZodEmailError(email: string): string | null {
  const result = RegisterSchema.safeParse({ email, password: 'placeholder12' })
  if (!result.success) {
    const emailIssue = result.error.issues.find((i) => i.path[0] === 'email')
    if (emailIssue) return 'Enter a valid email address.'
  }
  return null
}

function getZodPasswordError(password: string): string | null {
  const result = RegisterSchema.safeParse({ email: 'a@b.com', password })
  if (!result.success) {
    const passIssue = result.error.issues.find((i) => i.path[0] === 'password')
    if (passIssue) return 'Password must be at least 8 characters.'
  }
  return null
}

export function RegisterPage() {
  const { user, refresh } = useAuth()
  const navigate = useNavigate()
  const isGuest = user !== null && user.isGuest

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  function handleEmailBlur() {
    if (submitted) setEmailError(getZodEmailError(email))
  }

  function handlePasswordBlur() {
    if (submitted) setPasswordError(getZodPasswordError(password))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    setFormError(null)

    const emailErr = getZodEmailError(email)
    const passErr = getZodPasswordError(password)

    if (emailErr) {
      setEmailError(emailErr)
      return
    }
    if (passErr) {
      setPasswordError(passErr)
      return
    }
    setEmailError(null)
    setPasswordError(null)

    setLoading(true)
    try {
      const endpoint = isGuest ? '/api/auth/upgrade' : '/api/auth/register'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      })

      if (res.ok) {
        await refresh()
        await navigate('/', { replace: true })
      } else if (res.status === 409) {
        setFormError('An account with this email already exists. Sign in instead?')
      } else if (res.status === 429) {
        setFormError('Too many attempts. Try again in a moment.')
      } else {
        setFormError('Something went wrong on our end. Please try again.')
      }
    } catch {
      setFormError('Something went wrong on our end. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const heading = isGuest ? 'Save Your Progress' : 'Create Account'
  const submitLabel = isGuest ? 'Save & Continue' : 'Create Account'
  const loadingLabel = isGuest ? 'Saving…' : 'Creating account…'

  return (
    <AuthLayout>
      <AuthCard heading={heading}>
        <form onSubmit={(e) => void handleSubmit(e)} noValidate>
          <div className={styles.fields}>
            <GuestUpgradeBanner />
            <AuthInput
              label="Email"
              type="email"
              name="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (submitted) setEmailError(getZodEmailError(e.target.value))
              }}
              error={emailError ?? undefined}
              onBlur={handleEmailBlur}
            />
            <AuthInput
              label="Password"
              type="password"
              name="password"
              placeholder="••••••••"
              helperText="At least 8 characters"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (submitted) setPasswordError(getZodPasswordError(e.target.value))
              }}
              error={passwordError ?? undefined}
              onBlur={handlePasswordBlur}
            />
            <FormError error={formError} />
            <AuthButton loading={loading} loadingLabel={loadingLabel}>
              {submitLabel}
            </AuthButton>
            <TextLink to="/login">Already have an account? Sign in</TextLink>
          </div>
        </form>
      </AuthCard>
    </AuthLayout>
  )
}
