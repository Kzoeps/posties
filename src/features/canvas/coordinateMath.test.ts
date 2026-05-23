import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CANVAS_ZOOM,
  DEFAULT_MAX_CANVAS_ZOOM,
  DEFAULT_MIN_CANVAS_ZOOM,
  clampZoom,
  formatWorldLayerTransform,
  getViewportCenterWorldPoint,
  panViewportBy,
  screenToWorld,
  worldToScreen,
  zoomViewportAtScreenPoint,
  type CanvasPoint,
  type CanvasViewportTransform,
} from './coordinateMath'

describe('coordinate math', () => {
  it('round-trips world and screen coordinates across pan and zoom values', () => {
    const viewports: CanvasViewportTransform[] = [
      { pan: { x: 0, y: 0 }, zoom: 1 },
      { pan: { x: 120, y: -75 }, zoom: 0.5 },
      { pan: { x: -320.25, y: 88.5 }, zoom: 2.25 },
    ]
    const points: CanvasPoint[] = [
      { x: 0, y: 0 },
      { x: 42, y: -13 },
      { x: -1_500.5, y: 2_333.75 },
    ]

    for (const viewport of viewports) {
      for (const worldPoint of points) {
        const screenPoint = worldToScreen(worldPoint, viewport)
        const roundTripped = screenToWorld(screenPoint, viewport)

        expect(roundTripped.x).toBeCloseTo(worldPoint.x, 8)
        expect(roundTripped.y).toBeCloseTo(worldPoint.y, 8)
      }
    }
  })

  it('returns the world point at the current viewport center', () => {
    const center = getViewportCenterWorldPoint(
      { width: 800, height: 600 },
      { pan: { x: 100, y: -50 }, zoom: 2 },
    )

    expect(center).toEqual({ x: 150, y: 175 })
  })

  it('pans the viewport in screen space without changing zoom', () => {
    expect(panViewportBy({ pan: { x: 10, y: -20 }, zoom: 1.5 }, { x: 30, y: 45 })).toEqual({
      pan: { x: 40, y: 25 },
      zoom: 1.5,
    })
  })

  it('clamps invalid or out-of-range zoom values', () => {
    expect(clampZoom(Number.NaN)).toBe(DEFAULT_CANVAS_ZOOM)
    expect(clampZoom(DEFAULT_MIN_CANVAS_ZOOM / 10)).toBe(DEFAULT_MIN_CANVAS_ZOOM)
    expect(clampZoom(DEFAULT_MAX_CANVAS_ZOOM * 10)).toBe(DEFAULT_MAX_CANVAS_ZOOM)
    expect(clampZoom(1.75)).toBe(1.75)
  })

  it('zooms around a screen anchor so the anchored world point stays under the cursor', () => {
    const viewport: CanvasViewportTransform = { pan: { x: 50, y: -30 }, zoom: 1 }
    const screenAnchor = { x: 400, y: 300 }
    const worldBefore = screenToWorld(screenAnchor, viewport)
    const zoomed = zoomViewportAtScreenPoint(viewport, screenAnchor, 2)
    const worldAfter = screenToWorld(screenAnchor, zoomed)

    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 8)
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 8)
    expect(zoomed.zoom).toBe(2)
  })

  it('formats the CSS transform used by the world layer', () => {
    expect(formatWorldLayerTransform({ pan: { x: 12, y: -34 }, zoom: 1.25 })).toBe('translate(12px, -34px) scale(1.25)')
  })
})
