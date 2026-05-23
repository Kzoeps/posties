import { useId, useState, type FormEvent } from 'react'
import clsx from 'clsx'

import { QUOTE_COLORS, type QuoteColor, type QuoteEditableFields } from './quoteTypes'

type MaybePromise<T> = T | Promise<T>

/** Props for the quote creation form used before real PDS mutations are wired in. */
export type QuoteComposerProps = {
  onSubmit: (input: QuoteEditableFields) => MaybePromise<void>
  defaultColor?: QuoteColor
  disabled?: boolean
  isSubmitting?: boolean
  submitLabel?: string
  className?: string
}

/**
 * Form for creating a sticky quote.
 * It validates only the UX basics here and delegates persistence to the supplied callback.
 */
export function QuoteComposer({
  onSubmit,
  defaultColor = 'yellow',
  disabled = false,
  isSubmitting = false,
  submitLabel = 'Place note',
  className,
}: QuoteComposerProps) {
  const formId = useId()
  const [text, setText] = useState('')
  const [author, setAuthor] = useState('')
  const [sourceTitle, setSourceTitle] = useState('')
  const [sourceUri, setSourceUri] = useState('')
  const [color, setColor] = useState<QuoteColor>(defaultColor)
  const [localError, setLocalError] = useState<string | null>(null)
  const [localSubmitting, setLocalSubmitting] = useState(false)

  const submitting = isSubmitting || localSubmitting
  const blocked = disabled || submitting

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLocalError(null)

    const input = buildQuoteInput({ text, author, sourceTitle, sourceUri, color })
    if (!input.text) {
      setLocalError('Note text is required. Add the note before submitting.')
      return
    }

    setLocalSubmitting(true)
    try {
      await onSubmit(input)
      setText('')
      setAuthor('')
      setSourceTitle('')
      setSourceUri('')
      setColor(defaultColor)
    } catch (error) {
      setLocalError(getErrorMessage(error, 'Could not add the quote. Check the details and try again.'))
    } finally {
      setLocalSubmitting(false)
    }
  }

  return (
    <form className={clsx('quote-composer', className)} onSubmit={handleSubmit} aria-label="Add note">
      <div className="quote-composer__header">
        <p className="eyebrow">New paper slip</p>
        <div>
          <h2>Add note</h2>
          <p>Compose a public PDS quote record and place it on the canvas as a stationery slip.</p>
        </div>
      </div>

      <label className="quote-composer__field" htmlFor={`${formId}-text`}>
        <span>Note</span>
        <textarea
          id={`${formId}-text`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Write the note exactly as it should appear…"
          rows={5}
          disabled={blocked}
          required
        />
      </label>

      <div className="quote-composer__grid">
        <label className="quote-composer__field" htmlFor={`${formId}-author`}>
          <span>Author</span>
          <input
            id={`${formId}-author`}
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            placeholder="Optional"
            disabled={blocked}
          />
        </label>

        <label className="quote-composer__field" htmlFor={`${formId}-color`}>
          <span>Color</span>
          <select
            id={`${formId}-color`}
            value={color}
            onChange={(event) => setColor(event.target.value as QuoteColor)}
            disabled={blocked}
          >
            {QUOTE_COLORS.map((colorOption) => (
              <option key={colorOption} value={colorOption}>
                {toTitleCase(colorOption)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="quote-composer__grid">
        <label className="quote-composer__field" htmlFor={`${formId}-source-title`}>
          <span>Source title</span>
          <input
            id={`${formId}-source-title`}
            value={sourceTitle}
            onChange={(event) => setSourceTitle(event.target.value)}
            placeholder="Book, talk, article…"
            disabled={blocked}
          />
        </label>

        <label className="quote-composer__field" htmlFor={`${formId}-source-uri`}>
          <span>Source URL</span>
          <input
            id={`${formId}-source-uri`}
            value={sourceUri}
            onChange={(event) => setSourceUri(event.target.value)}
            placeholder="https://…"
            type="url"
            disabled={blocked}
          />
        </label>
      </div>

      {localError ? (
        <p className="quote-composer__error" role="alert">
          {localError}
        </p>
      ) : null}

      <div className="quote-composer__actions">
        <button className="quote-button quote-button--primary" type="submit" disabled={blocked}>
          {submitting ? 'Adding…' : submitLabel}
        </button>
      </div>
    </form>
  )
}

function buildQuoteInput(input: QuoteEditableFields): QuoteEditableFields {
  return {
    text: input.text.trim(),
    author: optionalText(input.author),
    sourceTitle: optionalText(input.sourceTitle),
    sourceUri: optionalText(input.sourceUri),
    color: input.color,
  }
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function toTitleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
