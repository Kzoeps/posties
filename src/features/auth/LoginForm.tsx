import { useId, useState, type FormEvent } from 'react'

/** Props for the handle-based login form. */
export type LoginFormProps = {
  /** Starts login for the submitted handle. The route owns navigation and error handling. */
  onSubmit: (handle: string) => Promise<void> | void
  /** Whether login startup is currently preparing the redirect request. */
  isSubmitting?: boolean
  /** Actionable error to show when login startup or session restore fails. */
  errorMessage?: string
  /** Disables the form while a parent route is performing auth work. */
  disabled?: boolean
}

/** Collects a handle and starts the login flow. */
export function LoginForm({ onSubmit, isSubmitting = false, errorMessage, disabled = false }: LoginFormProps) {
  const inputId = useId()
  const [handle, setHandle] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const canSubmit = !disabled && !isSubmitting

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedHandle = handle.trim().replace(/^@/, '')

    if (!normalizedHandle) {
      setLocalError('Enter your handle first.')
      return
    }

    setLocalError(null)
    await onSubmit(normalizedHandle)
  }

  return (
    <form className="login-form" aria-label="Log in" onSubmit={handleSubmit}>
      <label className="login-form__field" htmlFor={inputId}>
        <span>Handle</span>
        <input
          id={inputId}
          type="text"
          autoComplete="username"
          inputMode="email"
          placeholder="alice.bsky.social"
          value={handle}
          disabled={!canSubmit}
          autoFocus
          onChange={(event) => setHandle(event.currentTarget.value)}
        />
      </label>

      {localError || errorMessage ? (
        <p className="quote-composer__error" role="alert">
          {localError ?? errorMessage}
        </p>
      ) : null}

      <div className="login-form__actions">
        <button className="quote-button quote-button--primary" type="submit" disabled={!canSubmit}>
          {isSubmitting ? 'Logging in…' : 'Log in'}
        </button>
      </div>
    </form>
  )
}
