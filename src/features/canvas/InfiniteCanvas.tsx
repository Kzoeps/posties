import { memo, useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { StickyNote } from '../quotes/StickyNote'
import type { CanvasPosition, QuoteEditableFields, StickyNoteSize, StickyNoteViewModel } from '../quotes/quoteTypes'
import { useCanvasViewport } from './useCanvasViewport'
import { useDraggableNote } from './useDraggableNote'

type MaybePromise<T> = T | Promise<T>

/** Sticky quote data that the infinite canvas can render and move without knowing PDS internals. */
export type InfiniteCanvasQuote = StickyNoteViewModel & {
  /** Top-left note position in stable canvas world coordinates. */
  position: CanvasPosition
  /** Optional note dimensions in canvas world units. */
  size?: StickyNoteSize
  /** True when the note is an optimistic create that cannot be moved on the PDS yet. */
  isTemporary?: boolean
}

/** Props for the DOM-based infinite canvas viewport and its rendered sticky notes. */
export type InfiniteCanvasProps = {
  /** Optional arbitrary world-layer content for tests or future canvas adornments. */
  children?: ReactNode
  /** Sticky quote notes to render at their persisted world positions. */
  quotes?: readonly InfiniteCanvasQuote[]
  /** Persists one note's final rounded world position after a drag ends; omit it for viewer-only local moves. */
  onMoveQuote?: (quoteId: string, position: CanvasPosition) => MaybePromise<void>
  /** Updates editable quote text/metadata/color fields from the sticky note edit form. */
  onUpdateQuote?: (quoteId: string, input: QuoteEditableFields) => MaybePromise<void>
  /** Deletes one sticky quote after the note menu's confirmation flow. */
  onDeleteQuote?: (quoteId: string) => MaybePromise<void>
  /** Retries a failed quote mutation stored in higher-level query state. */
  onRetryQuote?: (quoteId: string) => MaybePromise<void>
  initialPan?: { x: number; y: number }
  initialZoom?: number
  minZoom?: number
  maxZoom?: number
  ariaLabel?: string
}

const GRID_SIZE_WORLD_UNITS = 48

/**
 * Renders the infinite canvas shell with panning, pointer-centered zoom, and draggable sticky notes.
 *
 * Notes are DOM elements inside the transformed world layer so their world coordinates remain stable while
 * the viewport pans and zooms. Viewer-only canvases can still move notes locally without writing to a PDS.
 */
export function InfiniteCanvas({
  children,
  quotes = [],
  onMoveQuote,
  onUpdateQuote,
  onDeleteQuote,
  onRetryQuote,
  initialPan,
  initialZoom,
  minZoom,
  maxZoom,
  ariaLabel = 'Infinite sticky quote canvas',
}: InfiniteCanvasProps) {
  const canvas = useCanvasViewport({ initialPan, initialZoom, minZoom, maxZoom })
  const zoomRef = useRef(canvas.viewport.zoom)
  zoomRef.current = canvas.viewport.zoom
  const getCanvasZoom = useCallback(() => zoomRef.current, [])
  const [frontQuoteId, setFrontQuoteId] = useState<string | null>(null)
  const bringQuoteToFront = useCallback((quoteId: string) => setFrontQuoteId(quoteId), [])
  const gridSize = GRID_SIZE_WORLD_UNITS * canvas.viewport.zoom
  const viewportClassName = canvas.isPanning ? 'infinite-canvas infinite-canvas--panning' : 'infinite-canvas'

  return (
    <div
      ref={canvas.viewportRef}
      role="application"
      aria-label={ariaLabel}
      tabIndex={0}
      className={viewportClassName}
      {...canvas.viewportHandlers}
      style={viewportInteractionStyle(canvas.isPanning)}
    >
      <div
        className="infinite-canvas__background"
        aria-hidden="true"
        data-canvas-background="true"
        style={backgroundVars(gridSize, canvas.viewport.pan.x, canvas.viewport.pan.y)}
      />

      <div className="infinite-canvas__world" data-canvas-world-layer="true" style={canvas.worldLayerStyle}>
        <CanvasOriginMarker />
        {quotes.map((quote) => (
          <DraggableCanvasNote
            key={quote.id}
            quote={quote}
            getZoom={getCanvasZoom}
            isFront={frontQuoteId === quote.id}
            onBringToFront={bringQuoteToFront}
            onMoveQuote={onMoveQuote}
            onUpdateQuote={onUpdateQuote}
            onDeleteQuote={onDeleteQuote}
            onRetryQuote={onRetryQuote}
          />
        ))}
        {children}
      </div>
    </div>
  )
}

type DraggableCanvasNoteProps = {
  quote: InfiniteCanvasQuote
  getZoom: () => number
  isFront: boolean
  onBringToFront: (quoteId: string) => void
  onMoveQuote?: (quoteId: string, position: CanvasPosition) => MaybePromise<void>
  onUpdateQuote?: (quoteId: string, input: QuoteEditableFields) => MaybePromise<void>
  onDeleteQuote?: (quoteId: string) => MaybePromise<void>
  onRetryQuote?: (quoteId: string) => MaybePromise<void>
}

const DraggableCanvasNote = memo(function DraggableCanvasNote({
  quote,
  getZoom,
  isFront,
  onBringToFront,
  onMoveQuote,
  onUpdateQuote,
  onDeleteQuote,
  onRetryQuote,
}: DraggableCanvasNoteProps) {
  const canDrag = !quote.isTemporary && quote.status !== 'saving' && quote.status !== 'deleting'
  const handleMoveEnd = useCallback(
    async (position: CanvasPosition) => {
      await onMoveQuote?.(quote.id, position)
    },
    [onMoveQuote, quote.id],
  )
  const handleBringToFront = useCallback(() => onBringToFront(quote.id), [onBringToFront, quote.id])
  const drag = useDraggableNote({
    noteId: quote.id,
    position: quote.position,
    zoom: getZoom,
    disabled: !canDrag,
    onMoveEnd: onMoveQuote ? handleMoveEnd : undefined,
  })
  const handleRetry = useCallback(() => {
    if (drag.errorMessage) {
      void drag.retry()
      return
    }

    if (onRetryQuote) void onRetryQuote(quote.id)
  }, [drag, onRetryQuote, quote.id])
  const noteStatus = drag.isSaving ? 'saving' : drag.errorMessage ? 'error' : quote.status
  const noteErrorMessage = drag.errorMessage ?? quote.errorMessage
  const noteViewModel: StickyNoteViewModel = {
    ...quote,
    status: noteStatus,
    errorMessage: noteErrorMessage,
  }

  return (
    <div
      data-canvas-sticky-note="true"
      data-world-x={Math.round(drag.position.x)}
      data-world-y={Math.round(drag.position.y)}
      data-unsaved-position={drag.hasUnsavedPosition || undefined}
      onPointerDownCapture={handleBringToFront}
      onFocusCapture={handleBringToFront}
      {...drag.dragHandlers}
      style={draggableNoteWrapperStyle(drag.position, canDrag, drag.isDragging, isFront)}
    >
      <StickyNote
        quote={noteViewModel}
        onUpdate={onUpdateQuote}
        onDelete={onDeleteQuote}
        onRetry={drag.errorMessage || quote.errorMessage ? handleRetry : undefined}
        style={stickyNoteSizeStyle(quote.size)}
      />
    </div>
  )
})

function CanvasOriginMarker() {
  return (
    <div className="infinite-canvas__origin-marker" aria-hidden="true">
      <span className="infinite-canvas__origin-axis infinite-canvas__origin-axis--x" />
      <span className="infinite-canvas__origin-axis infinite-canvas__origin-axis--y" />
      <span className="infinite-canvas__origin-dot" />
    </div>
  )
}

function viewportInteractionStyle(isPanning: boolean): CSSProperties {
  return {
    position: 'fixed',
    inset: 0,
    overflow: 'hidden',
    cursor: isPanning ? 'grabbing' : 'grab',
    touchAction: 'none',
    userSelect: isPanning ? 'none' : 'auto',
    overscrollBehavior: 'none',
  }
}

type CanvasBackgroundVars = CSSProperties & {
  '--canvas-grid-size': string
  '--canvas-grid-position': string
}

function backgroundVars(gridSize: number, panX: number, panY: number): CanvasBackgroundVars {
  return {
    '--canvas-grid-size': `${gridSize}px`,
    '--canvas-grid-position': `${panX}px ${panY}px`,
  }
}

function draggableNoteWrapperStyle(
  position: CanvasPosition,
  canDrag: boolean,
  isDragging: boolean,
  isFront: boolean,
): CSSProperties {
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: isDragging ? 20 : isFront ? 10 : undefined,
    cursor: canDrag ? (isDragging ? 'grabbing' : 'grab') : 'default',
    touchAction: 'none',
    userSelect: isDragging ? 'none' : 'auto',
    transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
    willChange: isDragging ? 'transform' : undefined,
  }
}

function stickyNoteSizeStyle(size: StickyNoteSize | undefined): CSSProperties | undefined {
  if (!size) return undefined

  return {
    width: size.width,
    minHeight: size.height,
  }
}
