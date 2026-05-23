import { useCallback, type CSSProperties, type ReactNode } from 'react'

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
  /** Persists one note's final rounded world position after a drag ends. */
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
 * the viewport pans and zooms.
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
  const centerWorldPoint = canvas.getViewportCenterWorldPoint()
  const gridSize = GRID_SIZE_WORLD_UNITS * canvas.viewport.zoom

  return (
    <div
      ref={canvas.viewportRef}
      role="application"
      aria-label={ariaLabel}
      tabIndex={0}
      {...canvas.viewportHandlers}
      style={viewportStyle(canvas.isPanning)}
    >
      <div
        aria-hidden="true"
        data-canvas-background="true"
        style={backgroundStyle(gridSize, canvas.viewport.pan.x, canvas.viewport.pan.y)}
      />

      <div data-canvas-world-layer="true" style={canvas.worldLayerStyle}>
        <CanvasOriginMarker />
        {quotes.map((quote) => (
          <DraggableCanvasNote
            key={quote.id}
            quote={quote}
            zoom={canvas.viewport.zoom}
            onMoveQuote={onMoveQuote}
            onUpdateQuote={onUpdateQuote}
            onDeleteQuote={onDeleteQuote}
            onRetryQuote={onRetryQuote}
          />
        ))}
        {children}
      </div>

      <div aria-hidden="true" style={instructionsStyle}>
        Drag canvas · wheel zoom · move paper slips
      </div>

      <div style={hudStyle}>
        <div style={hudMetricStyle}>
          <span>Zoom</span>
          <strong>{Math.round(canvas.viewport.zoom * 100)}%</strong>
        </div>
        <div style={hudMetricStyle}>
          <span>Center</span>
          <strong>
            {Math.round(centerWorldPoint.x)}, {Math.round(centerWorldPoint.y)}
          </strong>
        </div>
        <button type="button" onClick={canvas.resetViewport} style={resetButtonStyle}>
          Reset view
        </button>
      </div>
    </div>
  )
}

type DraggableCanvasNoteProps = {
  quote: InfiniteCanvasQuote
  zoom: number
  onMoveQuote?: (quoteId: string, position: CanvasPosition) => MaybePromise<void>
  onUpdateQuote?: (quoteId: string, input: QuoteEditableFields) => MaybePromise<void>
  onDeleteQuote?: (quoteId: string) => MaybePromise<void>
  onRetryQuote?: (quoteId: string) => MaybePromise<void>
}

function DraggableCanvasNote({
  quote,
  zoom,
  onMoveQuote,
  onUpdateQuote,
  onDeleteQuote,
  onRetryQuote,
}: DraggableCanvasNoteProps) {
  const canMove = Boolean(onMoveQuote) && !quote.isTemporary && quote.status !== 'saving' && quote.status !== 'deleting'
  const handleMoveEnd = useCallback(
    async (position: CanvasPosition) => {
      if (!onMoveQuote) return
      await onMoveQuote(quote.id, position)
    },
    [onMoveQuote, quote.id],
  )
  const drag = useDraggableNote({
    noteId: quote.id,
    position: quote.position,
    zoom,
    disabled: !canMove,
    onMoveEnd: handleMoveEnd,
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
      {...drag.dragHandlers}
      style={draggableNoteWrapperStyle(drag.position, canMove, drag.isDragging)}
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
}

function CanvasOriginMarker() {
  return (
    <div aria-hidden="true" style={originMarkerStyle}>
      <span style={originAxisXStyle} />
      <span style={originAxisYStyle} />
      <span style={originDotStyle} />
    </div>
  )
}

function viewportStyle(isPanning: boolean): CSSProperties {
  return {
    position: 'fixed',
    inset: 0,
    overflow: 'hidden',
    background: '#f3ede1',
    color: '#27231d',
    cursor: isPanning ? 'grabbing' : 'grab',
    touchAction: 'none',
    userSelect: isPanning ? 'none' : 'auto',
    overscrollBehavior: 'none',
  }
}

function backgroundStyle(gridSize: number, panX: number, panY: number): CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    backgroundColor: '#f3ede1',
    backgroundImage: [
      'linear-gradient(rgb(87 70 48 / 0.075) 1px, transparent 1px)',
      'linear-gradient(90deg, rgb(87 70 48 / 0.075) 1px, transparent 1px)',
      'linear-gradient(90deg, transparent 0 5.75rem, rgb(166 55 38 / 0.18) 5.8rem 5.85rem, transparent 5.9rem)',
      'radial-gradient(circle at 82% 16%, rgb(166 55 38 / 0.08), transparent 18rem)',
      'radial-gradient(circle at 20% 90%, rgb(68 84 63 / 0.08), transparent 22rem)',
    ].join(', '),
    backgroundPosition: `${panX}px ${panY}px, ${panX}px ${panY}px, left top, center, center`,
    backgroundSize: `${gridSize}px ${gridSize}px, ${gridSize}px ${gridSize}px, 100% 100%, 100% 100%, 100% 100%`,
  }
}

function draggableNoteWrapperStyle(position: CanvasPosition, canMove: boolean, isDragging: boolean): CSSProperties {
  return {
    position: 'absolute',
    left: position.x,
    top: position.y,
    cursor: canMove ? (isDragging ? 'grabbing' : 'grab') : 'default',
    touchAction: 'none',
    userSelect: isDragging ? 'none' : 'auto',
    willChange: isDragging ? 'left, top' : undefined,
  }
}

function stickyNoteSizeStyle(size: StickyNoteSize | undefined): CSSProperties | undefined {
  if (!size) return undefined

  return {
    width: size.width,
    minHeight: size.height,
  }
}

const instructionsStyle: CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: '1rem',
  transform: 'translateX(-50%)',
  border: '1px solid rgb(39 31 25 / 0.12)',
  borderRadius: '999px',
  background: 'rgb(251 247 237 / 0.78)',
  boxShadow: '0 1rem 2.5rem rgb(44 36 28 / 0.08)',
  color: '#716657',
  fontSize: '0.82rem',
  fontWeight: 500,
  letterSpacing: '0.08em',
  padding: '0.7rem 1rem',
  pointerEvents: 'none',
}

const hudStyle: CSSProperties = {
  position: 'absolute',
  right: '1rem',
  bottom: '1rem',
  display: 'flex',
  gap: '0.75rem',
  alignItems: 'center',
  border: '1px solid rgb(39 31 25 / 0.12)',
  borderRadius: '0.35rem',
  background: 'rgb(251 247 237 / 0.9)',
  boxShadow: '0 1rem 2.5rem rgb(44 36 28 / 0.1)',
  padding: '0.7rem',
}

const hudMetricStyle: CSSProperties = {
  display: 'grid',
  gap: '0.1rem',
  minWidth: '5.5rem',
  color: '#716657',
  fontSize: '0.72rem',
}

const resetButtonStyle: CSSProperties = {
  border: 0,
  borderRadius: '0.25rem',
  background: '#27231d',
  color: '#fbf7ed',
  cursor: 'pointer',
  fontWeight: 700,
  padding: '0.55rem 0.75rem',
}

const originMarkerStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 1,
  height: 1,
  pointerEvents: 'none',
}

const originAxisXStyle: CSSProperties = {
  position: 'absolute',
  left: -32,
  top: 0,
  width: 64,
  height: 1,
  background: 'rgb(166 55 38 / 0.38)',
}

const originAxisYStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: -32,
  width: 1,
  height: 64,
  background: 'rgb(166 55 38 / 0.38)',
}

const originDotStyle: CSSProperties = {
  position: 'absolute',
  left: -4,
  top: -4,
  width: 8,
  height: 8,
  borderRadius: 999,
  background: '#a63726',
  boxShadow: '0 0 0 4px rgb(166 55 38 / 0.12)',
}
