import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'

import {
  useCreateQuoteMutation,
  useDeleteQuoteMutation,
  useMoveQuoteMutation,
  useQuotesQuery,
  useUpdateQuoteMutation,
  type DeleteQuoteMutationInput,
  type MoveQuoteMutationInput,
  type QuoteCacheRecord,
  type UpdateQuoteMutationInput,
} from '../quotes/quoteQueries'
import { QuoteComposer } from '../quotes/QuoteComposer'
import type { CanvasPosition, QuoteEditableFields } from '../quotes/quoteTypes'
import { InfiniteCanvas } from './InfiniteCanvas'
import { findNearestFreeNotePosition } from './placement'

/** Page-owner context required to render a public or owner-editable canvas. */
export type CanvasPageProps = {
  /** Stable DID whose repo contains the quote records shown on this page. */
  ownerDid: string
  /** Canonical handle for the page owner, used only for labels and never stored in quote records. */
  ownerHandle: string
  /** Resolved PDS endpoint for unauthenticated public reads of the owner's DID repo. */
  ownerPdsEndpoint: string
  /** Active signed-in DID for the browser viewer, if any. */
  activeDid?: string | null
  /** True only when the active signed-in DID equals `ownerDid`; gates all write controls. */
  isOwner: boolean
}

/**
 * Page-level canvas composition for shareable public handle pages.
 * It always reads quote records by owner DID and PDS endpoint, while mutation handlers are only wired for the owner.
 */
export function CanvasPage({ ownerDid, ownerHandle, ownerPdsEndpoint, activeDid, isOwner }: CanvasPageProps) {
  const quotesQuery = useQuotesQuery(ownerDid, { auth: 'public', serviceEndpoint: ownerPdsEndpoint })
  const mutationDid = isOwner ? ownerDid : null
  const createQuoteMutation = useCreateQuoteMutation(mutationDid)
  const moveQuoteMutation = useMoveQuoteMutation(mutationDid)
  const updateQuoteMutation = useUpdateQuoteMutation(mutationDid)
  const deleteQuoteMutation = useDeleteQuoteMutation(mutationDid)
  const quotes = quotesQuery.data ?? []
  const quoteById = useMemo(() => new Map(quotes.map((quote) => [quote.id, quote])), [quotes])
  const composerDialogRef = useRef<HTMLDialogElement>(null)
  const [isComposerDialogOpen, setIsComposerDialogOpen] = useState(false)

  useEffect(() => {
    if (!isOwner) setIsComposerDialogOpen(false)
  }, [isOwner])

  useEffect(() => {
    const dialog = composerDialogRef.current
    if (!dialog) return

    if (isComposerDialogOpen) {
      if (!dialog.open) dialog.showModal()
      return
    }

    if (dialog.open) dialog.close()
  }, [isComposerDialogOpen])

  const handleCreateQuote = useCallback(
    async (input: QuoteEditableFields) => {
      const position = findNearestFreeNotePosition({
        viewportCenter: { x: 320, y: 160 },
        existingNotes: quotes,
      })
      await createQuoteMutation.mutateAsync({ ...input, position })
    },
    [createQuoteMutation, quotes],
  )

  const handleMoveQuote = useCallback(
    async (quoteId: string, position: CanvasPosition) => {
      const current = requireCachedQuote(quoteById, quoteId, 'move this sticky note')
      await moveQuoteMutation.mutateAsync({ current, position })
    },
    [moveQuoteMutation, quoteById],
  )

  const handleUpdateQuote = useCallback(
    async (quoteId: string, input: QuoteEditableFields) => {
      const current = requireCachedQuote(quoteById, quoteId, 'update this sticky note')
      await updateQuoteMutation.mutateAsync({ current, updates: input })
    },
    [quoteById, updateQuoteMutation],
  )

  const handleDeleteQuote = useCallback(
    async (quoteId: string) => {
      const current = requireCachedQuote(quoteById, quoteId, 'delete this sticky note')
      await deleteQuoteMutation.mutateAsync({ current })
    },
    [deleteQuoteMutation, quoteById],
  )

  const handleRetryQuote = useCallback(
    async (quoteId: string) => {
      const quote = requireCachedQuote(quoteById, quoteId, 'retry this sticky note change')
      const failure = quote.failedMutation
      if (!failure) return

      if (failure.action === 'move') {
        const retryInput = failure.input as MoveQuoteMutationInput
        await moveQuoteMutation.mutateAsync({ ...retryInput, current: quote, swapRecord: quote.cid })
        return
      }

      if (failure.action === 'update') {
        const retryInput = failure.input as UpdateQuoteMutationInput
        await updateQuoteMutation.mutateAsync({ ...retryInput, current: quote, swapRecord: quote.cid })
        return
      }

      if (failure.action === 'delete') {
        const retryInput = failure.input as DeleteQuoteMutationInput
        await deleteQuoteMutation.mutateAsync({ ...retryInput, current: quote, cid: quote.cid })
      }
    },
    [deleteQuoteMutation, moveQuoteMutation, quoteById, updateQuoteMutation],
  )

  const handleCreateQuoteFromDialog = useCallback(
    async (input: QuoteEditableFields) => {
      await handleCreateQuote(input)
      setIsComposerDialogOpen(false)
    },
    [handleCreateQuote],
  )

  function handleComposerDialogClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) setIsComposerDialogOpen(false)
  }

  return (
    <>
      <InfiniteCanvas
        quotes={quotes}
        onMoveQuote={isOwner ? handleMoveQuote : undefined}
        onUpdateQuote={isOwner ? handleUpdateQuote : undefined}
        onDeleteQuote={isOwner ? handleDeleteQuote : undefined}
        onRetryQuote={isOwner ? handleRetryQuote : undefined}
      />

      {quotesQuery.isPending || quotesQuery.isError ? (
        <aside className="canvas-status-panel" aria-live="polite">
          <strong>{quotesQuery.isError ? 'Could not load notes' : `Loading @${ownerHandle}`}</strong>
          <p>
            {quotesQuery.isError
              ? quotesQuery.error.message
              : `Reading public records from ${ownerDid}.`}
          </p>
        </aside>
      ) : null}

      {isOwner ? (
        <>
          <section className="canvas-command-bar" aria-label="Canvas controls">
            <button
              className="quote-button quote-button--primary canvas-command-bar__add"
              type="button"
              disabled={!activeDid}
              onClick={() => setIsComposerDialogOpen(true)}
            >
              <span aria-hidden="true">＋</span>
              Add note
            </button>
            <div className="canvas-command-bar__copy">
              <span className="canvas-command-bar__kicker">Public PDS notebook</span>
              <span>Place quotes as paper slips on the canvas.</span>
            </div>
          </section>

          <dialog
            ref={composerDialogRef}
            className="note-dialog"
            aria-label="Add note"
            onCancel={() => setIsComposerDialogOpen(false)}
            onClose={() => setIsComposerDialogOpen(false)}
            onClick={handleComposerDialogClick}
          >
            <div className="note-dialog__sheet">
              <button className="note-dialog__close" type="button" aria-label="Close add note dialog" onClick={() => setIsComposerDialogOpen(false)}>
                ×
              </button>
              <QuoteComposer
                className="quote-composer--dialog"
                onSubmit={handleCreateQuoteFromDialog}
                disabled={!activeDid}
                isSubmitting={createQuoteMutation.isPending}
                submitLabel="Place note"
              />
              {quotesQuery.isError ? (
                <p className="quote-composer__error" role="alert">
                  {quotesQuery.error.message}
                </p>
              ) : null}
            </div>
          </dialog>
        </>
      ) : null}
    </>
  )
}

function requireCachedQuote(quotes: ReadonlyMap<string, QuoteCacheRecord>, quoteId: string, action: string): QuoteCacheRecord {
  const quote = quotes.get(quoteId)
  if (!quote) {
    throw new Error(
      `Could not ${action}. What went wrong: quote ${quoteId} is not in the current canvas cache. What to do: refresh the quote list for the active account, then retry.`,
    )
  }

  return quote
}
