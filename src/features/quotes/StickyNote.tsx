import { useState, type CSSProperties, type FormEvent } from 'react'
import clsx from 'clsx'

import { QUOTE_COLORS, type QuoteColor, type QuoteEditableFields, type StickyNoteViewModel } from './quoteTypes'
import { StickyNoteMenu } from './StickyNoteMenu'

type MaybePromise<T> = T | Promise<T>

/** Props for rendering and editing one sticky quote note. */
export type StickyNoteProps = {
  quote: StickyNoteViewModel
  onUpdate?: (quoteId: string, input: QuoteEditableFields) => MaybePromise<void>
  onDelete?: (quoteId: string) => MaybePromise<void>
  onRetry?: (quoteId: string) => void
  className?: string
  style?: CSSProperties
}

/**
 * Presentational sticky note component for quote records.
 * Rotation is read from `rotationDegX100`; this component never generates random tilt during render.
 */
export function StickyNote({ quote, onUpdate, onDelete, onRetry, className, style }: StickyNoteProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [text, setText] = useState(quote.text)
  const [author, setAuthor] = useState(quote.author ?? '')
  const [sourceTitle, setSourceTitle] = useState(quote.sourceTitle ?? '')
  const [sourceUri, setSourceUri] = useState(quote.sourceUri ?? '')
  const [color, setColor] = useState<QuoteColor>(quote.color)
  const [localSaving, setLocalSaving] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const status = localSaving ? 'saving' : (quote.status ?? 'idle')
  const disabled = status === 'saving' || status === 'deleting'
  const hasNoteActions = Boolean(onUpdate || onDelete)
  const shouldShowTopbar = status !== 'idle' || hasNoteActions
  const rotationDeg = quote.rotationDegX100 / 100
  const noteStyle = {
    ...style,
    '--sticky-note-rotation': `${rotationDeg}deg`,
  } as CSSProperties & { '--sticky-note-rotation': string }

  function startEditing() {
    setText(quote.text)
    setAuthor(quote.author ?? '')
    setSourceTitle(quote.sourceTitle ?? '')
    setSourceUri(quote.sourceUri ?? '')
    setColor(quote.color)
    setLocalError(null)
    setIsEditing(true)
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!onUpdate) return

    const input = buildQuoteInput({ text, author, sourceTitle, sourceUri, color })
    if (!input.text) {
      setLocalError('Note text is required. Add text before saving this note.')
      return
    }

    setLocalSaving(true)
    setLocalError(null)
    try {
      await onUpdate(quote.id, input)
      setIsEditing(false)
    } catch (error) {
      setLocalError(getErrorMessage(error, 'Could not save this quote. Try again.'))
    } finally {
      setLocalSaving(false)
    }
  }

  return (
    <article
      className={clsx('sticky-note', `sticky-note--${quote.color}`, `sticky-note--status-${status}`, className)}
      style={noteStyle}
      data-quote-id={quote.id}
      data-rotation-deg-x100={quote.rotationDegX100}
      aria-label="Sticky note"
    >
      <div className="sticky-note__pin" aria-hidden="true" />

      {isEditing ? (
        <form className="sticky-note__edit-form" onSubmit={handleSave} aria-label="Edit note">
          <label className="sticky-note__edit-field">
            <span>Note</span>
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={6} disabled={disabled} required />
          </label>

          <label className="sticky-note__edit-field">
            <span>Author</span>
            <input value={author} onChange={(event) => setAuthor(event.target.value)} disabled={disabled} />
          </label>

          <label className="sticky-note__edit-field">
            <span>Source title</span>
            <input value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} disabled={disabled} />
          </label>

          <label className="sticky-note__edit-field">
            <span>Source URL</span>
            <input value={sourceUri} onChange={(event) => setSourceUri(event.target.value)} type="url" disabled={disabled} />
          </label>

          <label className="sticky-note__edit-field">
            <span>Color</span>
            <select value={color} onChange={(event) => setColor(event.target.value as QuoteColor)} disabled={disabled}>
              {QUOTE_COLORS.map((colorOption) => (
                <option key={colorOption} value={colorOption}>
                  {toTitleCase(colorOption)}
                </option>
              ))}
            </select>
          </label>

          {localError ? (
            <p className="sticky-note__error" role="alert">
              {localError}
            </p>
          ) : null}

          <div className="sticky-note__edit-actions">
            <button className="quote-button quote-button--primary" type="submit" disabled={disabled}>
              {localSaving ? 'Saving…' : 'Save'}
            </button>
            <button className="quote-button quote-button--ghost" type="button" onClick={() => setIsEditing(false)} disabled={localSaving}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          {shouldShowTopbar ? (
            <div className="sticky-note__topbar" aria-label="Sticky note status and owner controls">
              {status !== 'idle' ? <span className="sticky-note__status">{getStatusLabel(status)}</span> : null}
              {hasNoteActions ? (
                <div className="sticky-note__owner-controls" aria-label="Owner note controls">
                  <StickyNoteMenu
                    quoteId={quote.id}
                    onEdit={onUpdate ? startEditing : undefined}
                    onDelete={onDelete}
                    isDeleting={status === 'deleting'}
                    className="sticky-note-menu--quiet"
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <figure className="sticky-note__content">
            <blockquote className="sticky-note__quote">{quote.text}</blockquote>
            {quote.author ? <figcaption className="sticky-note__author">— {quote.author}</figcaption> : null}
          </figure>

          {quote.sourceTitle || quote.sourceUri ? <SourceLine sourceTitle={quote.sourceTitle} sourceUri={quote.sourceUri} /> : null}

          {quote.errorMessage ? (
            <div className="sticky-note__error-block" role="alert">
              <p>{quote.errorMessage}</p>
              {onRetry ? (
                <button className="quote-button quote-button--ghost" type="button" onClick={() => onRetry(quote.id)}>
                  {quote.retryLabel ?? 'Retry'}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </article>
  )
}

type SourceLineProps = {
  sourceTitle?: string
  sourceUri?: string
}

function SourceLine({ sourceTitle, sourceUri }: SourceLineProps) {
  const safeHref = getSafeExternalHref(sourceUri)
  const label = sourceTitle ?? sourceUri

  if (!label) return null

  return (
    <p className="sticky-note__source">
      {safeHref ? (
        <a href={safeHref} target="_blank" rel="noreferrer noopener">
          <span>{label}</span>
          <span aria-hidden="true"> ↗</span>
        </a>
      ) : (
        <>
          <span>{label}</span>
          <span aria-hidden="true"> ↗</span>
        </>
      )}
    </p>
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

function getSafeExternalHref(sourceUri: string | undefined): string | null {
  if (!sourceUri) return null

  try {
    const url = new URL(sourceUri)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function getStatusLabel(status: StickyNoteViewModel['status'] | 'idle'): string {
  switch (status) {
    case 'saving':
      return 'Saving…'
    case 'error':
      return 'Needs attention'
    case 'deleting':
      return 'Deleting…'
    case 'idle':
    case undefined:
      return ''
  }
}

function toTitleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
