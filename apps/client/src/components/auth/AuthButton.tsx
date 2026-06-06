import styles from './AuthButton.module.css'

interface AuthButtonProps {
  loading?: boolean
  disabled?: boolean
  children: React.ReactNode
  loadingLabel?: string
  onClick?: () => void
  type?: 'submit' | 'button' | 'reset'
}

export function AuthButton({
  loading = false,
  disabled = false,
  children,
  loadingLabel,
  onClick,
  type = 'submit',
}: AuthButtonProps) {
  return (
    <button className={styles.btn} type={type} disabled={disabled || loading} onClick={onClick}>
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  )
}
