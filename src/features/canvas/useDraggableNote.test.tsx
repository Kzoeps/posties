import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CanvasPoint } from './coordinateMath'
import { useDraggableNote } from './useDraggableNote'

type HarnessProps = {
  position?: CanvasPoint
  zoom?: number
  onMoveEnd?: (position: CanvasPoint) => Promise<void> | void
}

function DraggableHarness({ position = { x: 10, y: 20 }, zoom = 2, onMoveEnd }: HarnessProps) {
  const drag = useDraggableNote({ noteId: 'quote-1', position, zoom, onMoveEnd })

  return (
    <div
      data-testid="note"
      data-x={drag.position.x}
      data-y={drag.position.y}
      data-saving={drag.isSaving || undefined}
      data-error={drag.errorMessage ?? ''}
      {...drag.dragHandlers}
    >
      <button type="button">Edit</button>
      <button type="button" onClick={() => void drag.retry()}>
        Retry
      </button>
    </div>
  )
}

describe('useDraggableNote', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: vi.fn(() => true),
    })
  })

  it('updates local position during drag and persists one rounded world position on pointer up', async () => {
    const onMoveEnd = vi.fn().mockResolvedValue(undefined)
    render(<DraggableHarness onMoveEnd={onMoveEnd} zoom={2} />)

    const note = screen.getByTestId('note')
    fireEvent.pointerDown(note, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(note, { pointerId: 1, clientX: 140, clientY: 70 })

    expect(note.getAttribute('data-x')).toBe('30')
    expect(note.getAttribute('data-y')).toBe('5')
    expect(onMoveEnd).not.toHaveBeenCalled()

    fireEvent.pointerUp(note, { pointerId: 1, clientX: 140, clientY: 70 })

    await waitFor(() => expect(onMoveEnd).toHaveBeenCalledTimes(1))
    expect(onMoveEnd).toHaveBeenCalledWith({ x: 30, y: 5 })
  })

  it('divides screen deltas by zoom and rounds only the final persisted coordinates', async () => {
    const onMoveEnd = vi.fn().mockResolvedValue(undefined)
    render(<DraggableHarness onMoveEnd={onMoveEnd} position={{ x: 0, y: 0 }} zoom={4} />)

    const note = screen.getByTestId('note')
    fireEvent.pointerDown(note, { pointerId: 1, button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(note, { pointerId: 1, clientX: 10, clientY: 6 })

    expect(note.getAttribute('data-x')).toBe('2.5')
    expect(note.getAttribute('data-y')).toBe('1.5')

    fireEvent.pointerUp(note, { pointerId: 1, clientX: 10, clientY: 6 })

    await waitFor(() => expect(onMoveEnd).toHaveBeenCalledTimes(1))
    expect(onMoveEnd).toHaveBeenCalledWith({ x: 3, y: 2 })
  })

  it('accepts a local-only final position when no persistence handler is provided', async () => {
    render(<DraggableHarness />)

    const note = screen.getByTestId('note')
    fireEvent.pointerDown(note, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(note, { pointerId: 1, clientX: 120, clientY: 140 })
    fireEvent.pointerUp(note, { pointerId: 1, clientX: 120, clientY: 140 })

    await waitFor(() => expect(note.getAttribute('data-x')).toBe('20'))
    expect(note.getAttribute('data-y')).toBe('40')
    expect(note.getAttribute('data-saving')).toBeNull()
    expect(note.getAttribute('data-error')).toBe('')
  })

  it('keeps the unsaved position visible after a failed save and can retry it', async () => {
    const onMoveEnd = vi.fn().mockRejectedValueOnce(new Error('PDS unavailable')).mockResolvedValueOnce(undefined)
    render(<DraggableHarness onMoveEnd={onMoveEnd} zoom={2} />)

    const note = screen.getByTestId('note')
    fireEvent.pointerDown(note, { pointerId: 1, button: 0, clientX: 20, clientY: 20 })
    fireEvent.pointerMove(note, { pointerId: 1, clientX: 40, clientY: 40 })
    fireEvent.pointerUp(note, { pointerId: 1, clientX: 40, clientY: 40 })

    await waitFor(() => expect(note.getAttribute('data-error')).toContain('PDS unavailable'))
    expect(note.getAttribute('data-x')).toBe('20')
    expect(note.getAttribute('data-y')).toBe('30')

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(onMoveEnd).toHaveBeenCalledTimes(2))
    expect(onMoveEnd).toHaveBeenLastCalledWith({ x: 20, y: 30 })
    await waitFor(() => expect(note.getAttribute('data-error')).toBe(''))
  })
})
