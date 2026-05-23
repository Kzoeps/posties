/** A two-dimensional point in either screen pixels or canvas world units. */
export type CanvasPoint = {
  x: number
  y: number
}

/** Width and height in screen pixels or canvas world units, depending on caller context. */
export type CanvasSize = {
  width: number
  height: number
}

/** The pan/zoom transform that maps stable canvas world coordinates to viewport screen coordinates. */
export type CanvasViewportTransform = {
  pan: CanvasPoint
  zoom: number
}

/** The default minimum zoom allowed by the infinite canvas viewport. */
export const DEFAULT_MIN_CANVAS_ZOOM = 0.2

/** The default maximum zoom allowed by the infinite canvas viewport. */
export const DEFAULT_MAX_CANVAS_ZOOM = 3

/** The default zoom used when the canvas first mounts or is reset. */
export const DEFAULT_CANVAS_ZOOM = 1

/** Prevents a zoom value from leaving the configured viewport zoom range. */
export function clampZoom(
  zoom: number,
  minZoom = DEFAULT_MIN_CANVAS_ZOOM,
  maxZoom = DEFAULT_MAX_CANVAS_ZOOM,
): number {
  if (!Number.isFinite(zoom)) return DEFAULT_CANVAS_ZOOM
  return Math.min(Math.max(zoom, minZoom), maxZoom)
}

/** Converts a point measured in viewport screen pixels into stable canvas world coordinates. */
export function screenToWorld(
  screenPoint: CanvasPoint,
  viewport: CanvasViewportTransform,
): CanvasPoint {
  return {
    x: (screenPoint.x - viewport.pan.x) / viewport.zoom,
    y: (screenPoint.y - viewport.pan.y) / viewport.zoom,
  }
}

/** Converts a stable canvas world coordinate into viewport screen pixels. */
export function worldToScreen(
  worldPoint: CanvasPoint,
  viewport: CanvasViewportTransform,
): CanvasPoint {
  return {
    x: worldPoint.x * viewport.zoom + viewport.pan.x,
    y: worldPoint.y * viewport.zoom + viewport.pan.y,
  }
}

/** Returns the world coordinate currently shown at the center of the viewport. */
export function getViewportCenterWorldPoint(
  viewportSize: CanvasSize,
  viewport: CanvasViewportTransform,
): CanvasPoint {
  return screenToWorld(
    {
      x: viewportSize.width / 2,
      y: viewportSize.height / 2,
    },
    viewport,
  )
}

/** Moves the viewport by a screen-space delta without changing any canvas world coordinates. */
export function panViewportBy(
  viewport: CanvasViewportTransform,
  delta: CanvasPoint,
): CanvasViewportTransform {
  return {
    ...viewport,
    pan: {
      x: viewport.pan.x + delta.x,
      y: viewport.pan.y + delta.y,
    },
  }
}

/**
 * Returns a new viewport zoomed around a screen-space anchor point.
 *
 * The world coordinate under `screenAnchor` remains under the same cursor position after zooming.
 */
export function zoomViewportAtScreenPoint(
  viewport: CanvasViewportTransform,
  screenAnchor: CanvasPoint,
  nextZoom: number,
  minZoom = DEFAULT_MIN_CANVAS_ZOOM,
  maxZoom = DEFAULT_MAX_CANVAS_ZOOM,
): CanvasViewportTransform {
  const zoom = clampZoom(nextZoom, minZoom, maxZoom)
  const anchoredWorldPoint = screenToWorld(screenAnchor, viewport)

  return {
    zoom,
    pan: {
      x: screenAnchor.x - anchoredWorldPoint.x * zoom,
      y: screenAnchor.y - anchoredWorldPoint.y * zoom,
    },
  }
}

/** Formats the world-layer CSS transform used by the DOM-based infinite canvas. */
export function formatWorldLayerTransform(viewport: CanvasViewportTransform): string {
  return `translate(${viewport.pan.x}px, ${viewport.pan.y}px) scale(${viewport.zoom})`
}
