import styles from './FormError.module.css'

interface FormErrorProps {
  error: string | null
}

export function FormError({ error }: FormErrorProps) {
  if (!error) return null

  return <div className={styles.banner}>{error}</div>
}
