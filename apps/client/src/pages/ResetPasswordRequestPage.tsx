import { useState } from 'react'
import { AuthLayout } from '../components/auth/AuthLayout.js'
import { AuthCard } from '../components/auth/AuthCard.js'
import { AuthInput } from '../components/auth/AuthInput.js'
import { AuthButton } from '../components/auth/AuthButton.js'
import { FormError } from '../components/auth/FormError.js'
import { TextLink } from '../components/auth/TextLink.js'
import styles from './ResetPasswordRequestPage.module.css'

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function ResetPasswordRequestPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    // Validate email format first
    if (!isValidEmail(email)) {
      setEmailError('Enter a valid email address.')
      return
    }
    setEmailError(null)

    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      })

      if (res.ok || res.status === 404) {
        // Always show success state after valid email — prevents user enumeration
        setSuccess(true)
      } else if (res.status === 429) {
        setFormError('Too many requests. Please wait 15 minutes before trying again.')
      } else {
        setFormError('Something went wrong on our end. Please try again.')
      }
    } catch {
      setFormError('Something went wrong on our end. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <AuthLayout>
        <AuthCard heading="Check your email">
          <p className={styles.successBody}>
            If an account exists for that address, a reset link is on its way. Check your spam
            folder if it doesn&apos;t arrive within a few minutes.
          </p>
          <TextLink to="/">Back to home</TextLink>
        </AuthCard>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <AuthCard heading="Reset Password">
        <p className={styles.subCopy}>Enter your email and we&apos;ll send you a reset link.</p>
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
                if (emailError) setEmailError(null)
              }}
              error={emailError ?? undefined}
            />
            <FormError error={formError} />
            <AuthButton loading={loading} loadingLabel="Sending…">
              Send Reset Link
            </AuthButton>
            <TextLink to="/">Back to home</TextLink>
          </div>
        </form>
      </AuthCard>
    </AuthLayout>
  )
}
