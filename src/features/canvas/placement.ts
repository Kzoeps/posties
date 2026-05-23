/**
 * Default sticky note dimensions used before app-level config exists.
 * These match the v1 product plan and keep placement deterministic for tests.
 */
export const DEFAULT_NOTE_SIZE: NoteSize = Object.freeze({ width: 240, height: 180 })

/**
 * Minimum world-coordinate space to keep between unrotated sticky note bounds.
 * Rotation is intentionally ignored for v1 placement, so this gap gives tilted notes visual breathing room.
 */
export const DEFAULT_NOTE_GAP = 32

/**
 * Maximum number of grid rings to scan before reporting that placement failed.
 * Fifty rings is enough for dense local clusters without hiding infinite loops from callers.
 */
export const DEFAULT_MAX_PLACEMENT_RINGS = 50

/** A point in infinite-canvas world coordinates. */
export interface CanvasPoint {
  x: number
  y: number
}

/** Width and height of a note in infinite-canvas world units. */
export interface NoteSize {
  width: number
  height: number
}

/** Axis-aligned note rectangle used for collision checks before CSS rotation is applied. */
export interface NoteBounds extends CanvasPoint, NoteSize {}

/**
 * Existing note data needed by the placement search.
 * `position` is the note's top-left world coordinate; missing size fields fall back to the default sticky note size.
 */
export interface NotePlacementInput {
  position: CanvasPoint
  size?: Partial<NoteSize>
}

/** Options for finding a free position for a newly created sticky note. */
export interface FindFreeNotePositionOptions {
  /** Top-left starting coordinate for the new note, normally the current viewport center in world coordinates. */
  viewportCenter: CanvasPoint
  /** Existing notes to avoid when choosing the new note position. */
  existingNotes?: readonly NotePlacementInput[]
  /** Size of the note being placed. Defaults to the v1 sticky note size. */
  noteSize?: Partial<NoteSize>
  /** Minimum spacing between unrotated note bounds. Defaults to `DEFAULT_NOTE_GAP`. */
  gap?: number
  /** Number of spiral/grid rings to scan before failing. Defaults to `DEFAULT_MAX_PLACEMENT_RINGS`. */
  maxRings?: number
}

/**
 * Builds the unrotated axis-aligned bounds for a note.
 * Use this when tests or callers need to reason about placement without CSS rotation.
 */
export function getNoteBounds(position: CanvasPoint, size?: Partial<NoteSize>): NoteBounds {
  const normalizedPosition = normalizePoint(position, 'position')
  const normalizedSize = normalizeSize(size, 'size')

  return {
    x: normalizedPosition.x,
    y: normalizedPosition.y,
    width: normalizedSize.width,
    height: normalizedSize.height,
  }
}

/**
 * Returns whether two unrotated note bounds overlap after applying the requested spacing gap.
 * Edge contact at exactly the gap distance is allowed and does not count as a collision.
 */
export function noteBoundsOverlap(a: NoteBounds, b: NoteBounds, gap = DEFAULT_NOTE_GAP): boolean {
  const normalizedA = normalizeBounds(a, 'a')
  const normalizedB = normalizeBounds(b, 'b')
  const normalizedGap = normalizeNonNegativeNumber(gap, 'gap')

  return (
    normalizedA.x < normalizedB.x + normalizedB.width + normalizedGap &&
    normalizedA.x + normalizedA.width > normalizedB.x - normalizedGap &&
    normalizedA.y < normalizedB.y + normalizedB.height + normalizedGap &&
    normalizedA.y + normalizedA.height > normalizedB.y - normalizedGap
  )
}

/**
 * Finds the nearest collision-free top-left world coordinate for a new sticky note.
 * The search starts at `viewportCenter`, then scans deterministic grid rings around it using the new note size plus gap.
 */
export function findNearestFreeNotePosition(options: FindFreeNotePositionOptions): CanvasPoint {
  const origin = normalizePoint(options.viewportCenter, 'viewportCenter')
  const noteSize = normalizeSize(options.noteSize, 'noteSize')
  const gap = normalizeNonNegativeNumber(options.gap ?? DEFAULT_NOTE_GAP, 'gap')
  const maxRings = normalizeNonNegativeInteger(options.maxRings ?? DEFAULT_MAX_PLACEMENT_RINGS, 'maxRings')
  const occupiedBounds = (options.existingNotes ?? []).map((note, index) =>
    getNoteBounds(note.position, note.size ?? DEFAULT_NOTE_SIZE),
  )

  if (isPositionFree(origin, noteSize, occupiedBounds, gap)) {
    return origin
  }

  const xStep = noteSize.width + gap
  const yStep = noteSize.height + gap

  for (let ring = 1; ring <= maxRings; ring += 1) {
    for (const candidate of createRingCandidates(origin, ring, xStep, yStep)) {
      if (isPositionFree(candidate, noteSize, occupiedBounds, gap)) {
        return candidate
      }
    }
  }

  throw new Error(
    `Could not find a free note position within ${maxRings} placement ring(s). Increase maxRings, reduce the gap, or inspect existing note bounds.`,
  )
}

function isPositionFree(
  position: CanvasPoint,
  noteSize: NoteSize,
  occupiedBounds: readonly NoteBounds[],
  gap: number,
): boolean {
  const candidateBounds = getNoteBounds(position, noteSize)
  return occupiedBounds.every((bounds) => !noteBoundsOverlap(candidateBounds, bounds, gap))
}

function createRingCandidates(origin: CanvasPoint, ring: number, xStep: number, yStep: number): CanvasPoint[] {
  const candidates: CanvasPoint[] = []

  for (let gridX = -ring; gridX <= ring; gridX += 1) {
    candidates.push({ x: origin.x + gridX * xStep, y: origin.y - ring * yStep })
    candidates.push({ x: origin.x + gridX * xStep, y: origin.y + ring * yStep })
  }

  for (let gridY = -ring + 1; gridY <= ring - 1; gridY += 1) {
    candidates.push({ x: origin.x - ring * xStep, y: origin.y + gridY * yStep })
    candidates.push({ x: origin.x + ring * xStep, y: origin.y + gridY * yStep })
  }

  return candidates.sort((a, b) => {
    const distanceDelta = squaredDistance(a, origin) - squaredDistance(b, origin)
    if (distanceDelta !== 0) return distanceDelta
    if (a.y !== b.y) return a.y - b.y
    return a.x - b.x
  })
}

function squaredDistance(a: CanvasPoint, b: CanvasPoint): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2
}

function normalizeBounds(bounds: NoteBounds, path: string): NoteBounds {
  const position = normalizePoint(bounds, path)
  const size = normalizeSize(bounds, path)

  return { ...position, ...size }
}

function normalizePoint(point: CanvasPoint, path: string): CanvasPoint {
  return {
    x: normalizeFiniteNumber(point.x, `${path}.x`),
    y: normalizeFiniteNumber(point.y, `${path}.y`),
  }
}

function normalizeSize(size: Partial<NoteSize> | undefined, path: string): NoteSize {
  return {
    width: normalizePositiveNumber(size?.width ?? DEFAULT_NOTE_SIZE.width, `${path}.width`),
    height: normalizePositiveNumber(size?.height ?? DEFAULT_NOTE_SIZE.height, `${path}.height`),
  }
}

function normalizeFiniteNumber(value: number, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${path}: expected a finite number.`)
  }

  return value
}

function normalizePositiveNumber(value: number, path: string): number {
  const normalized = normalizeFiniteNumber(value, path)
  if (normalized <= 0) {
    throw new Error(`Invalid ${path}: expected a positive number greater than 0.`)
  }

  return normalized
}

function normalizeNonNegativeNumber(value: number, path: string): number {
  const normalized = normalizeFiniteNumber(value, path)
  if (normalized < 0) {
    throw new Error(`Invalid ${path}: expected a number greater than or equal to 0.`)
  }

  return normalized
}

function normalizeNonNegativeInteger(value: number, path: string): number {
  const normalized = normalizeNonNegativeNumber(value, path)
  if (!Number.isInteger(normalized)) {
    throw new Error(`Invalid ${path}: expected an integer greater than or equal to 0.`)
  }

  return normalized
}
