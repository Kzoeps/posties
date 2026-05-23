import { useId, useState, type FormEvent } from 'react'

/** Props for the handle-based ATProto OAuth login form. */
export type LoginFormProps = {
  /** Starts OAuth for the submitted handle. The route owns navigation and error handling. */
  onSubmit: (handle: string) => Promise<void> | void
  /** Whether OAuth startup is currently building the authorization request. */
  isSubmitting?: boolean
  /** Actionable error to show when OAuth startup or session restore fails. */
  errorMessage?: string
  /** Disables the form while a parent route is performing auth work. */
  disabled?: boolean
}

/**
 * Collects an ATProto handle and starts the OAuth login flow.
 * The warning is intentionally part of the form so users see that quotes are
 * public PDS records before they create their first sticky note.
 */
export function LoginForm({ onSubmit, isSubmitting = false, errorMessage, disabled = false }: LoginFormProps) {
  const inputId = useId()
  const [handle, setHandle] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const canSubmit = !disabled && !isSubmitting

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedHandle = handle.trim().replace(/^@/, '')

    if (!normalizedHandle) {
      setLocalError('Enter your ATProto handle, for example alice.bsky.social, then try again.')
      return
    }

    setLocalError(null)
    await onSubmit(normalizedHandle)
  }

  return (
    <form className="quote-composer" aria-label="Sign in with ATProto" onSubmit={handleSubmit}>
      <div className="quote-composer__header">
        <p className="eyebrow">ATProto OAuth</p>
        <h2>Sign in to your sticky quote canvas</h2>
        <p>Use your Bluesky or ATProto handle. Your quotes will be written as public records on your PDS.</p>
      </div>

      <p className="auth-public-warning" role="note">
        Public data warning: every quote you create, edit, move, or delete is stored in your public PDS repo for this v1 app.
        Do not save private notes here.
      </p>

      <label className="quote-composer__field" htmlFor={inputId}>
        <span>ATProto handle</span>
        <input
          id={inputId}
          type="text"
          autoComplete="username"
          inputMode="email"
          placeholder="alice.bsky.social"
          value={handle}
          disabled={!canSubmit}
          onChange={(event) => setHandle(event.currentTarget.value)}
        />
      </label>

      {localError || errorMessage ? (
        <p className="quote-composer__error" role="alert">
          {localError ?? errorMessage}
        </p>
      ) : null}

      <div className="quote-composer__actions">
        <button className="quote-button quote-button--primary" type="submit" disabled={!canSubmit}>
          {isSubmitting ? 'Opening OAuth…' : 'Continue with ATProto'}
        </button>
      </div>
    </form>
  )
}
