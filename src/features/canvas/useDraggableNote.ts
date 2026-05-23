import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import type { CanvasPoint } from './coordinateMath'

type MaybePromise<T> = T | Promise<T>

/** Options for `useDraggableNote`, the hook that turns one sticky note into a movable canvas item. */
export type UseDraggableNoteOptions = {
  /** Stable quote id used in error messages and future analytics/debugging. */
  noteId: string
  /** Latest persisted top-left note position in canvas world coordinates. */
  position: CanvasPoint
  /** Current canvas zoom multiplier; screen drag deltas are divided by this value. */
  zoom: number
  /** Disables drag start while a note is being created, deleted, or otherwise unavailable. */
  disabled?: boolean
  /** Persists the final rounded world position after the pointer is released. */
  onMoveEnd: (position: CanvasPoint) => MaybePromise<void>
}

/** Pointer handlers that should be attached to the note's canvas-positioned wrapper. */
export type DraggableNoteHandlers = {
  /** Starts dragging when the primary pointer goes down on non-interactive note content. */
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  /** Updates the local world position while the active pointer moves. */
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  /** Stops dragging and persists the final rounded world position. */
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  /** Stops dragging without writing when the browser cancels the pointer stream. */
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void
}

/** State and handlers returned by `useDraggableNote` for rendering and retrying one movable note. */
export type DraggableNoteController = {
  /** Current display position in world coordinates; may be unsaved after a failed move. */
  position: CanvasPoint
  /** Pointer handlers for the absolute-positioned note wrapper. */
  dragHandlers: DraggableNoteHandlers
  /** True while the pointer is actively moving this note. */
  isDragging: boolean
  /** True while the final drag position is being persisted. */
  isSaving: boolean
  /** True when the displayed position differs from the last known persisted position. */
  hasUnsavedPosition: boolean
  /** User-facing error from the last failed movement save. */
  errorMessage?: string
  /** Retries persisting the currently displayed position after a failed movement save. */
  retry: () => Promise<void>
  /** Clears the local drag error without changing the displayed position. */
  clearError: () => void
}

type ActiveDrag = {
  pointerId: number
  startScreenPoint: CanvasPoint
  startPosition: CanvasPoint
  zoomAtStart: number
}

/**
 * Manages pointer-based sticky-note dragging in canvas world coordinates.
 *
 * The hook captures the active pointer on the note wrapper, stops propagation so the canvas does not pan,
 * divides screen deltas by the current zoom, updates local position during movement, and calls `onMoveEnd`
 * only once on pointer release with rounded integer world coordinates.
 */
export function useDraggableNote(options: UseDraggableNoteOptions): DraggableNoteController {
  const activeDragRef = useRef<ActiveDrag | null>(null)
  const persistedPositionRef = useRef<CanvasPoint>(options.position)
  const displayPositionRef = useRef<CanvasPoint>(options.position)
  const [displayPosition, setDisplayPositionState] = useState<CanvasPoint>(options.position)
  const [isDragging, setIsDragging] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | undefined>()

  const setDisplayPosition = useCallback((position: CanvasPoint) => {
    displayPositionRef.current = position
    setDisplayPositionState(position)
  }, [])

  useEffect(() => {
    persistedPositionRef.current = options.position

    if (!activeDragRef.current && !isSaving && !errorMessage) {
      setDisplayPosition(options.position)
    }
  }, [errorMessage, isSaving, options.position, setDisplayPosition])

  const persistPosition = useCallback(
    async (position: CanvasPoint) => {
      const roundedPosition = roundCanvasPosition(position)
      setDisplayPosition(roundedPosition)
      setIsSaving(true)
      setErrorMessage(undefined)

      try {
        await options.onMoveEnd(roundedPosition)
        persistedPositionRef.current = roundedPosition
        setDisplayPosition(roundedPosition)
      } catch (error) {
        setErrorMessage(getMoveErrorMessage(options.noteId, error))
      } finally {
        setIsSaving(false)
      }
    },
    [options, setDisplayPosition],
  )

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (options.disabled || event.button !== 0 || !isNoteDragTarget(event)) return

      event.preventDefault()
      event.stopPropagation()
      capturePointer(event.currentTarget, event.pointerId)
      activeDragRef.current = {
        pointerId: event.pointerId,
        startScreenPoint: { x: event.clientX, y: event.clientY },
        startPosition: displayPositionRef.current,
        zoomAtStart: normalizeZoom(options.zoom),
      }
      setErrorMessage(undefined)
      setIsDragging(true)
    },
    [options.disabled, options.zoom],
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const activeDrag = activeDragRef.current
      if (!activeDrag || activeDrag.pointerId !== event.pointerId) return

      event.preventDefault()
      event.stopPropagation()
      setDisplayPosition({
        x: activeDrag.startPosition.x + (event.clientX - activeDrag.startScreenPoint.x) / activeDrag.zoomAtStart,
        y: activeDrag.startPosition.y + (event.clientY - activeDrag.startScreenPoint.y) / activeDrag.zoomAtStart,
      })
    },
    [setDisplayPosition],
  )

  const stopDragging = useCallback(
    async (event: ReactPointerEvent<HTMLDivElement>, shouldPersist: boolean) => {
      const activeDrag = activeDragRef.current
      if (!activeDrag || activeDrag.pointerId !== event.pointerId) return

      event.preventDefault()
      event.stopPropagation()
      releasePointer(event.currentTarget, event.pointerId)
      activeDragRef.current = null
      setIsDragging(false)

      if (!shouldPersist) {
        if (!errorMessage) setDisplayPosition(persistedPositionRef.current)
        return
      }

      const finalPosition = roundCanvasPosition(displayPositionRef.current)
      if (pointsEqual(finalPosition, roundCanvasPosition(persistedPositionRef.current))) {
        setDisplayPosition(finalPosition)
        return
      }

      await persistPosition(finalPosition)
    },
    [errorMessage, persistPosition, setDisplayPosition],
  )

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      void stopDragging(event, true)
    },
    [stopDragging],
  )

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      void stopDragging(event, false)
    },
    [stopDragging],
  )

  const retry = useCallback(async () => {
    await persistPosition(displayPositionRef.current)
  }, [persistPosition])

  const clearError = useCallback(() => setErrorMessage(undefined), [])
  const roundedDisplayPosition = roundCanvasPosition(displayPosition)
  const hasUnsavedPosition = !pointsEqual(roundedDisplayPosition, roundCanvasPosition(persistedPositionRef.current))

  const dragHandlers = useMemo<DraggableNoteHandlers>(
    () => ({
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
    }),
    [handlePointerCancel, handlePointerDown, handlePointerMove, handlePointerUp],
  )

  return {
    position: displayPosition,
    dragHandlers,
    isDragging,
    isSaving,
    hasUnsavedPosition,
    errorMessage,
    retry,
    clearError,
  }
}

function roundCanvasPosition(position: CanvasPoint): CanvasPoint {
  return {
    x: Math.round(position.x),
    y: Math.round(position.y),
  }
}

function pointsEqual(left: CanvasPoint, right: CanvasPoint): boolean {
  return left.x === right.x && left.y === right.y
}

function normalizeZoom(zoom: number): number {
  return typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0 ? zoom : 1
}

function isNoteDragTarget(event: ReactPointerEvent<HTMLDivElement>): boolean {
  const target = event.target
  if (!(target instanceof Element)) return false

  return target.closest('button, a, input, textarea, select, summary, [role="button"], [data-no-note-drag="true"]') === null
}

function capturePointer(element: HTMLDivElement, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId)
  } catch {
    // Pointer capture can fail if the browser has already canceled the pointer stream.
  }
}

function releasePointer(element: HTMLDivElement, pointerId: number): void {
  try {
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId)
    }
  } catch {
    // Releasing a missing capture is harmless and should not block drag cleanup.
  }
}

function getMoveErrorMessage(noteId: string, error: unknown): string {
  const cause = error instanceof Error && error.message ? error.message : String(error)
  return `Could not save the new position for note ${noteId}. What went wrong: ${cause} What to do: retry the move after the PDS or network connection is healthy.`
}
