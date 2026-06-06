import styles from './AuthCard.module.css'

interface AuthCardProps {
  heading: string
  children: React.ReactNode
}

export function AuthCard({ heading, children }: AuthCardProps) {
  return (
    <div className={styles.card}>
      <h1 className={styles.heading}>{heading}</h1>
      {children}
    </div>
  )
}
