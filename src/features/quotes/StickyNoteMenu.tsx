import { useState } from 'react'
import clsx from 'clsx'

type MaybePromise<T> = T | Promise<T>

/** Props for sticky note action controls such as edit and guarded delete. */
export type StickyNoteMenuProps = {
  quoteId: string
  onEdit?: (quoteId: string) => void
  onDelete?: (quoteId: string) => MaybePromise<void>
  disabled?: boolean
  isDeleting?: boolean
  className?: string
}

/**
 * Action menu for a sticky note.
 * Delete is a two-step flow so accidental clicks do not immediately remove a note.
 */
export function StickyNoteMenu({
  quoteId,
  onEdit,
  onDelete,
  disabled = false,
  isDeleting = false,
  className,
}: StickyNoteMenuProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [localDeleting, setLocalDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const deleting = isDeleting || localDeleting
  const blocked = disabled || deleting

  async function handleConfirmDelete() {
    if (!onDelete) return

    setError(null)
    setLocalDeleting(true)
    try {
      await onDelete(quoteId)
      setConfirmingDelete(false)
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, 'Could not delete this quote. Try again.'))
    } finally {
      setLocalDeleting(false)
    }
  }

  if (!onEdit && !onDelete) return null

  return (
    <div className={clsx('sticky-note-menu', className)} aria-label="Sticky note actions">
      {confirmingDelete ? (
        <div className="sticky-note-menu__confirm" role="group" aria-label="Confirm delete quote">
          <span>Delete?</span>
          <button className="quote-button quote-button--danger" type="button" onClick={handleConfirmDelete} disabled={blocked}>
            {deleting ? 'Deleting…' : 'Confirm'}
          </button>
          <button
            className="quote-button quote-button--ghost"
            type="button"
            onClick={() => {
              setConfirmingDelete(false)
              setError(null)
            }}
            disabled={deleting}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="sticky-note-menu__actions">
          {onEdit ? (
            <button className="quote-button quote-button--ghost" type="button" onClick={() => onEdit(quoteId)} disabled={blocked}>
              Edit
            </button>
          ) : null}
          {onDelete ? (
            <button
              className="quote-button quote-button--ghost sticky-note-menu__delete-trigger"
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={blocked}
            >
              Delete
            </button>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="sticky-note-menu__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
