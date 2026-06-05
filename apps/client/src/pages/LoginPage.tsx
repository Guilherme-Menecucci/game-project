import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { LoginSchema } from '@game/shared'
import { useAuth } from '../components/auth/AuthProvider.js'
import { AuthLayout } from '../components/auth/AuthLayout.js'
import { AuthCard } from '../components/auth/AuthCard.js'
import { AuthInput } from '../components/auth/AuthInput.js'
import { AuthButton } from '../components/auth/AuthButton.js'
import { FormError } from '../components/auth/FormError.js'
import { TextLink } from '../components/auth/TextLink.js'
import styles from './LoginPage.module.css'

function getZodEmailError(email: string): string | null {
  const result = LoginSchema.safeParse({ email, password: 'placeholder12' })
  if (!result.success) {
    const emailIssue = result.error.issues.find((i) => i.path[0] === 'email')
    if (emailIssue) return 'Enter a valid email address.'
  }
  return null
}

function getZodPasswordError(password: string): string | null {
  const result = LoginSchema.safeParse({ email: 'a@b.com', password })
  if (!result.success) {
    const passIssue = result.error.issues.find((i) => i.path[0] === 'password')
    if (passIssue) return 'Password must be at least 8 characters.'
  }
  return null
}

export function LoginPage() {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

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

    // Client-side validation first
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
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      })

      if (res.ok) {
        await refresh()
        // Validate redirect param: must start with / and not start with //
        const redirect = searchParams.get('redirect') ?? '/'
        const target =
          redirect.startsWith('/') && !redirect.startsWith('//')
            ? decodeURIComponent(redirect)
            : '/'
        await navigate(target, { replace: true })
      } else if (res.status === 401) {
        setFormError('Invalid email or password. Please try again.')
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

  return (
    <AuthLayout>
      <AuthCard heading="Sign In">
        <form onSubmit={(e) => void handleSubmit(e)} noValidate>
          <div className={styles.fields}>
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
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (submitted) setPasswordError(getZodPasswordError(e.target.value))
              }}
              error={passwordError ?? undefined}
              onBlur={handlePasswordBlur}
            />
            <TextLink to="/reset-password">Forgot your password?</TextLink>
            <FormError error={formError} />
            <AuthButton loading={loading} loadingLabel="Signing in…">
              Sign In
            </AuthButton>
            <TextLink to="/register">Don&apos;t have an account? Create one</TextLink>
          </div>
        </form>
      </AuthCard>
    </AuthLayout>
  )
}
