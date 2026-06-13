import styles from './AuthLayout.module.css'

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className={styles.layout}>{children}</div>
}
