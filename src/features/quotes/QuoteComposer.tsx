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
  submitLabel = 'Place on canvas',
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
    <form className={clsx('quote-composer', className)} onSubmit={handleSubmit} aria-label="Add a new note">
      <div className="quote-composer__header">
        <h2>Add a new note</h2>
      </div>

      <label className="quote-composer__field" htmlFor={`${formId}-text`}>
        <span>Quote</span>
        <textarea
          id={`${formId}-text`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Write your quote here…"
          rows={5}
          disabled={blocked}
          required
        />
      </label>

      <label className="quote-composer__field" htmlFor={`${formId}-author`}>
        <span>Author</span>
        <input
          id={`${formId}-author`}
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
          placeholder="Author name"
          disabled={blocked}
        />
      </label>

      <label className="quote-composer__field" htmlFor={`${formId}-source-title`}>
        <span>Source title</span>
        <input
          id={`${formId}-source-title`}
          value={sourceTitle}
          onChange={(event) => setSourceTitle(event.target.value)}
          placeholder="Source or book title"
          disabled={blocked}
        />
      </label>

      <label className="quote-composer__field" htmlFor={`${formId}-source-uri`}>
        <span>Source URL <span className="quote-composer__optional">(optional)</span></span>
        <input
          id={`${formId}-source-uri`}
          value={sourceUri}
          onChange={(event) => setSourceUri(event.target.value)}
          placeholder="https://example.com"
          type="url"
          disabled={blocked}
        />
      </label>

      <fieldset className="quote-composer__field quote-composer__swatch-field">
        <legend>Note color</legend>
        <div className="quote-composer__swatches">
          {QUOTE_COLORS.map((colorOption) => (
            <label key={colorOption} className="quote-composer__swatch-option" data-color={colorOption}>
              <input
                type="radio"
                name={`${formId}-color`}
                value={colorOption}
                checked={color === colorOption}
                onChange={() => setColor(colorOption)}
                disabled={blocked}
              />
              <span className="quote-composer__swatch" aria-hidden="true" />
              <span className="quote-composer__swatch-label">{toTitleCase(colorOption)}</span>
            </label>
          ))}
        </div>
      </fieldset>

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
