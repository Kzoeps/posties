import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { InfiniteCanvas, type InfiniteCanvasQuote } from './InfiniteCanvas'

const INITIAL_PAN = { x: 380, y: 160 }

/** Exercises browser-level pointer targeting for the DOM canvas layer stack. */
describe('InfiniteCanvas viewport panning', () => {
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

  it('pans when a drag starts on the empty world layer above the background', () => {
    const { container } = render(<InfiniteCanvas initialPan={INITIAL_PAN} />)
    const canvas = screen.getByRole('application', { name: 'Infinite sticky quote canvas' })
    const worldLayer = getWorldLayer(container)

    fireEvent.pointerDown(worldLayer, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 150, clientY: 120 })

    expect(worldLayer.style.transform).toBe('translate(430px, 180px) scale(1)')
  })

  it('does not pan when a drag starts on sticky note content', () => {
    const { container } = render(<InfiniteCanvas initialPan={INITIAL_PAN} quotes={[quote]} />)
    const canvas = screen.getByRole('application', { name: 'Infinite sticky quote canvas' })
    const worldLayer = getWorldLayer(container)
    const stickyNote = getStickyNotes(container)[0]

    fireEvent.pointerDown(stickyNote, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 150, clientY: 120 })

    expect(worldLayer.style.transform).toBe('translate(380px, 160px) scale(1)')
  })

  it('moves sticky notes locally even when no persistence handler is provided', () => {
    const { container } = render(<InfiniteCanvas initialPan={INITIAL_PAN} quotes={[quote]} />)
    const stickyNote = getStickyNotes(container)[0]

    fireEvent.pointerDown(stickyNote, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(stickyNote, { pointerId: 1, clientX: 150, clientY: 130 })
    fireEvent.pointerUp(stickyNote, { pointerId: 1, clientX: 150, clientY: 130 })

    expect(stickyNote.getAttribute('data-world-x')).toBe('60')
    expect(stickyNote.getAttribute('data-world-y')).toBe('50')
    expect(stickyNote.style.cursor).toBe('grab')
  })

  it('raises the most recently interacted sticky note above the others', () => {
    const secondQuote: InfiniteCanvasQuote = { ...quote, id: 'quote-2', position: { x: 30, y: 40 }, text: 'Second note' }
    const { container } = render(<InfiniteCanvas initialPan={INITIAL_PAN} quotes={[quote, secondQuote]} />)
    const [firstNote, secondNote] = getStickyNotes(container)

    fireEvent.pointerDown(firstNote, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerUp(firstNote, { pointerId: 1, clientX: 100, clientY: 100 })

    expect(firstNote.style.zIndex).toBe('10')
    expect(secondNote.style.zIndex).toBe('')

    fireEvent.pointerDown(secondNote, { pointerId: 2, button: 0, clientX: 120, clientY: 120 })
    fireEvent.pointerUp(secondNote, { pointerId: 2, clientX: 120, clientY: 120 })

    expect(firstNote.style.zIndex).toBe('')
    expect(secondNote.style.zIndex).toBe('10')
  })
})

function getWorldLayer(container: HTMLElement): HTMLElement {
  const worldLayer = container.querySelector<HTMLElement>('[data-canvas-world-layer="true"]')
  if (!worldLayer) throw new Error('Expected the infinite canvas world layer to render.')
  return worldLayer
}

function getStickyNotes(container: HTMLElement): HTMLElement[] {
  const stickyNotes = Array.from(container.querySelectorAll<HTMLElement>('[data-canvas-sticky-note="true"]'))
  if (stickyNotes.length === 0) throw new Error('Expected at least one test sticky note to render.')
  return stickyNotes
}

const quote: InfiniteCanvasQuote = {
  id: 'quote-1',
  text: 'A sticky note should not start canvas panning.',
  color: 'yellow',
  rotationDegX100: 0,
  position: { x: 10, y: 20 },
}
