import { Link } from 'react-router'
import styles from './TextLink.module.css'

interface TextLinkProps {
  to: string
  children: React.ReactNode
}

export function TextLink({ to, children }: TextLinkProps) {
  return (
    <Link to={to} className={styles.link}>
      {children}
    </Link>
  )
}
