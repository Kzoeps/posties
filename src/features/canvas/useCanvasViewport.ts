import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  RefObject,
  WheelEvent as ReactWheelEvent,
} from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'

import {
  DEFAULT_CANVAS_ZOOM,
  DEFAULT_MAX_CANVAS_ZOOM,
  DEFAULT_MIN_CANVAS_ZOOM,
  type CanvasPoint,
  type CanvasSize,
  type CanvasViewportTransform,
  clampZoom,
  formatWorldLayerTransform,
  getViewportCenterWorldPoint,
  panViewportBy,
  screenToWorld as convertScreenToWorld,
  worldToScreen as convertWorldToScreen,
  zoomViewportAtScreenPoint,
} from './coordinateMath'

/** Configuration for the infinite canvas viewport hook. */
export type UseCanvasViewportOptions = {
  initialPan?: CanvasPoint
  initialZoom?: number
  minZoom?: number
  maxZoom?: number
}

/** React pointer and wheel handlers that should be attached to the canvas viewport element. */
export type CanvasViewportHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void
}

/** The complete viewport API consumed by canvas rendering and future sticky-note drag logic. */
export type CanvasViewportController = {
  viewportRef: RefObject<HTMLDivElement | null>
  viewport: CanvasViewportTransform
  viewportHandlers: CanvasViewportHandlers
  worldLayerStyle: CSSProperties
  minZoom: number
  maxZoom: number
  isPanning: boolean
  setPan: (pan: CanvasPoint) => void
  setZoom: (zoom: number) => void
  setViewport: (viewport: CanvasViewportTransform) => void
  resetViewport: () => void
  screenToWorld: (screenPoint: CanvasPoint) => CanvasPoint
  worldToScreen: (worldPoint: CanvasPoint) => CanvasPoint
  getViewportCenterWorldPoint: () => CanvasPoint
  zoomAtScreenPoint: (screenPoint: CanvasPoint, zoom: number) => void
}

type ActivePan = {
  pointerId: number
  startScreenPoint: CanvasPoint
  startPan: CanvasPoint
}

const DEFAULT_PAN: CanvasPoint = { x: 0, y: 0 }

/**
 * Owns the infinite canvas pan/zoom state and event handlers.
 *
 * The returned conversion helpers keep sticky-note world coordinates stable while the user pans and zooms.
 */
export function useCanvasViewport(options: UseCanvasViewportOptions = {}): CanvasViewportController {
  const minZoom = options.minZoom ?? DEFAULT_MIN_CANVAS_ZOOM
  const maxZoom = options.maxZoom ?? DEFAULT_MAX_CANVAS_ZOOM
  const initialPan = options.initialPan ?? DEFAULT_PAN
  const initialZoom = clampZoom(options.initialZoom ?? DEFAULT_CANVAS_ZOOM, minZoom, maxZoom)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const activePanRef = useRef<ActivePan | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [viewport, updateViewport] = useState<CanvasViewportTransform>(() => ({
    pan: initialPan,
    zoom: initialZoom,
  }))

  const setViewport = useCallback(
    (nextViewport: CanvasViewportTransform) => {
      updateViewport({
        pan: nextViewport.pan,
        zoom: clampZoom(nextViewport.zoom, minZoom, maxZoom),
      })
    },
    [maxZoom, minZoom],
  )

  const setPan = useCallback((pan: CanvasPoint) => {
    updateViewport((currentViewport) => ({ ...currentViewport, pan }))
  }, [])

  const setZoom = useCallback(
    (zoom: number) => {
      updateViewport((currentViewport) => ({
        ...currentViewport,
        zoom: clampZoom(zoom, minZoom, maxZoom),
      }))
    },
    [maxZoom, minZoom],
  )

  const resetViewport = useCallback(() => {
    updateViewport({ pan: initialPan, zoom: initialZoom })
  }, [initialPan, initialZoom])

  const zoomAtScreenPoint = useCallback(
    (screenPoint: CanvasPoint, zoom: number) => {
      updateViewport((currentViewport) =>
        zoomViewportAtScreenPoint(currentViewport, screenPoint, zoom, minZoom, maxZoom),
      )
    },
    [maxZoom, minZoom],
  )

  const screenToWorld = useCallback(
    (screenPoint: CanvasPoint) => convertScreenToWorld(screenPoint, viewport),
    [viewport],
  )

  const worldToScreen = useCallback(
    (worldPoint: CanvasPoint) => convertWorldToScreen(worldPoint, viewport),
    [viewport],
  )

  const getViewportCenterWorld = useCallback(() => {
    const viewportSize = getViewportSize(viewportRef.current)
    return getViewportCenterWorldPoint(viewportSize, viewport)
  }, [viewport])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !isCanvasPanTarget(event)) return

      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      activePanRef.current = {
        pointerId: event.pointerId,
        startScreenPoint: { x: event.clientX, y: event.clientY },
        startPan: viewport.pan,
      }
      setIsPanning(true)
    },
    [viewport.pan],
  )

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const activePan = activePanRef.current
    if (!activePan || activePan.pointerId !== event.pointerId) return

    event.preventDefault()
    updateViewport((currentViewport) =>
      panViewportBy(
        { ...currentViewport, pan: activePan.startPan },
        {
          x: event.clientX - activePan.startScreenPoint.x,
          y: event.clientY - activePan.startScreenPoint.y,
        },
      ),
    )
  }, [])

  const stopPanning = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const activePan = activePanRef.current
    if (!activePan || activePan.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    activePanRef.current = null
    setIsPanning(false)
  }, [])

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      event.preventDefault()

      const rect = event.currentTarget.getBoundingClientRect()
      const screenAnchor = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }
      const deltaPixels = normalizeWheelDelta(event, rect.height)
      const zoomMultiplier = Math.exp(-deltaPixels / 500)

      updateViewport((currentViewport) =>
        zoomViewportAtScreenPoint(
          currentViewport,
          screenAnchor,
          currentViewport.zoom * zoomMultiplier,
          minZoom,
          maxZoom,
        ),
      )
    },
    [maxZoom, minZoom],
  )

  const viewportHandlers = useMemo<CanvasViewportHandlers>(
    () => ({
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: stopPanning,
      onPointerCancel: stopPanning,
      onWheel: handleWheel,
    }),
    [handlePointerDown, handlePointerMove, handleWheel, stopPanning],
  )

  const worldLayerStyle = useMemo<CSSProperties>(
    () => ({
      position: 'absolute',
      left: 0,
      top: 0,
      transform: formatWorldLayerTransform(viewport),
      transformOrigin: '0 0',
      willChange: 'transform',
    }),
    [viewport],
  )

  return {
    viewportRef,
    viewport,
    viewportHandlers,
    worldLayerStyle,
    minZoom,
    maxZoom,
    isPanning,
    setPan,
    setZoom,
    setViewport,
    resetViewport,
    screenToWorld,
    worldToScreen,
    getViewportCenterWorldPoint: getViewportCenterWorld,
    zoomAtScreenPoint,
  }
}

function getViewportSize(element: HTMLDivElement | null): CanvasSize {
  if (!element) return { width: 0, height: 0 }
  return {
    width: element.clientWidth,
    height: element.clientHeight,
  }
}

function isCanvasPanTarget(event: ReactPointerEvent<HTMLDivElement>): boolean {
  const target = event.target
  if (!(target instanceof Element)) return false
  return event.currentTarget === target || target.closest('[data-canvas-background="true"]') !== null
}

function normalizeWheelDelta(event: ReactWheelEvent<HTMLDivElement>, viewportHeight: number): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * Math.max(viewportHeight, 1)
  return event.deltaY
}
