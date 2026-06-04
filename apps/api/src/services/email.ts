import { Resend } from 'resend'
import { env } from '../env.js'

/**
 * Resend email client singleton (D-08).
 * In NODE_ENV=development, emails are console.logged instead of sent.
 * In NODE_ENV=production, uses resend.emails.send() via RESEND_API_KEY.
 *
 * Lazy initialization: Resend is instantiated on first use, not at module load time.
 * This prevents the constructor from running during test imports where the API key
 * may be a placeholder value (which Resend rejects at construction with a ByteString error).
 */
let resendInstance: Resend | null = null
function getResend(): Resend {
  if (!resendInstance) {
    resendInstance = new Resend(env.RESEND_API_KEY)
  }
  return resendInstance
}

const FROM_ADDRESS = 'noreply@' + new URL(env.BASE_URL).hostname

/**
 * Send a password reset email.
 * Dev fallback: logs the reset link to console.
 * Production: sends via Resend API (RESEND_API_KEY must be set).
 *
 * NOTE (D-08 test coverage): Plan 02-04 MUST add vi.mock('resend') asserting
 * sendVerificationEmail calls resend.emails.send() with correct args — the
 * production send path must be verified, not just the dev console.log branch.
 */
export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
  if (env.NODE_ENV === 'development') {
    console.log(`[DEV] Password reset link for ${to}: ${resetLink}`)
    return
  }
  await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: 'Reset your password',
    html: `<p>Click the link below to reset your password. This link expires in 15 minutes.</p>
<p><a href="${resetLink}">${resetLink}</a></p>
<p>If you did not request a password reset, you can safely ignore this email.</p>`,
  })
}

/**
 * Send an email verification email.
 * Dev fallback: logs the verify link to console.
 * Production: sends via Resend API.
 */
export async function sendVerificationEmail(to: string, verifyLink: string): Promise<void> {
  if (env.NODE_ENV === 'development') {
    console.log(`[DEV] Email verification link for ${to}: ${verifyLink}`)
    return
  }
  await getResend().emails.send({
    from: FROM_ADDRESS,
    to,
    subject: 'Verify your email address',
    html: `<p>Click the link below to verify your email address.</p>
<p><a href="${verifyLink}">${verifyLink}</a></p>
<p>If you did not create an account, you can safely ignore this email.</p>`,
  })
}
