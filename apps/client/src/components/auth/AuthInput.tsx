import styles from './AuthInput.module.css'

interface AuthInputProps {
  label: string
  type: string
  name: string
  placeholder: string
  helperText?: string
  error?: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onBlur?: () => void
}

export function AuthInput({
  label,
  type,
  name,
  placeholder,
  helperText,
  error,
  value,
  onChange,
  onBlur,
}: AuthInputProps) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        className={`${styles.input}${error ? ` ${styles.inputError}` : ''}`}
        type={type}
        name={name}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        aria-describedby={error ? `${name}-error` : helperText ? `${name}-helper` : undefined}
      />
      {error ? (
        <span id={`${name}-error`} className={styles.error}>
          {error}
        </span>
      ) : helperText ? (
        <span id={`${name}-helper`} className={styles.helper}>
          {helperText}
        </span>
      ) : null}
    </div>
  )
}
