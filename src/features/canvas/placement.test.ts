import { describe, expect, it } from 'vitest'

import {
  DEFAULT_NOTE_GAP,
  DEFAULT_NOTE_SIZE,
  findNearestFreeNotePosition,
  getNoteBounds,
  noteBoundsOverlap,
  type CanvasPoint,
  type NoteBounds,
  type NotePlacementInput,
} from './placement'

describe('note placement', () => {
  it('returns the viewport center when the canvas is empty', () => {
    expect(findNearestFreeNotePosition({ viewportCenter: { x: 100, y: -50 } })).toEqual({ x: 100, y: -50 })
  })

  it('keeps exact-gap edge contact from counting as a collision', () => {
    const first = { x: 0, y: 0, width: 10, height: 10 }
    const exactlyAtGap = { x: 15, y: 0, width: 10, height: 10 }
    const insideGap = { x: 14.99, y: 0, width: 10, height: 10 }

    expect(noteBoundsOverlap(first, exactlyAtGap, 5)).toBe(false)
    expect(noteBoundsOverlap(first, insideGap, 5)).toBe(true)
  })

  it('uses negative world coordinates without clamping to the visible screen', () => {
    expect(findNearestFreeNotePosition({ viewportCenter: { x: -420, y: -260 } })).toEqual({ x: -420, y: -260 })
  })

  it('uses custom note sizes when searching for the nearest free position', () => {
    const position = findNearestFreeNotePosition({
      viewportCenter: { x: 0, y: 0 },
      existingNotes: [{ position: { x: 0, y: 0 }, size: { width: 100, height: 100 } }],
      noteSize: { width: 50, height: 50 },
      gap: 10,
      maxRings: 1,
    })

    expect(position).toEqual({ x: 0, y: -60 })
  })

  it('searches beyond a dense first ring and returns a non-overlapping candidate', () => {
    const origin = { x: 0, y: 0 }
    const existingNotes = denseClusterAroundOrigin()
    const position = findNearestFreeNotePosition({ viewportCenter: origin, existingNotes, maxRings: 2 })

    expect(position).toEqual({ x: 0, y: -424 })
    expect(noOverlapWithExisting(position, existingNotes)).toBe(true)
  })

  it('throws when no free position exists within maxRings', () => {
    expect(() =>
      findNearestFreeNotePosition({
        viewportCenter: { x: 0, y: 0 },
        existingNotes: [{ position: { x: 0, y: 0 } }],
        maxRings: 0,
      }),
    ).toThrow(/Could not find a free note position within 0 placement ring/)
  })

  it('normalizes note bounds with default dimensions', () => {
    expect(getNoteBounds({ x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: DEFAULT_NOTE_SIZE.width,
      height: DEFAULT_NOTE_SIZE.height,
    })
  })
})

function denseClusterAroundOrigin(): NotePlacementInput[] {
  const xStep = DEFAULT_NOTE_SIZE.width + DEFAULT_NOTE_GAP
  const yStep = DEFAULT_NOTE_SIZE.height + DEFAULT_NOTE_GAP
  const positions: CanvasPoint[] = [
    { x: 0, y: 0 },
    { x: -xStep, y: -yStep },
    { x: 0, y: -yStep },
    { x: xStep, y: -yStep },
    { x: -xStep, y: 0 },
    { x: xStep, y: 0 },
    { x: -xStep, y: yStep },
    { x: 0, y: yStep },
    { x: xStep, y: yStep },
  ]

  return positions.map((position) => ({ position }))
}

function noOverlapWithExisting(position: CanvasPoint, existingNotes: readonly NotePlacementInput[]): boolean {
  const candidate: NoteBounds = getNoteBounds(position)
  return existingNotes.every((note) => !noteBoundsOverlap(candidate, getNoteBounds(note.position, note.size)))
}
