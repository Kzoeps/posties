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
    const stickyNote = container.querySelector<HTMLElement>('[data-canvas-sticky-note="true"]')

    if (!stickyNote) throw new Error('Expected the test sticky note to render.')

    fireEvent.pointerDown(stickyNote, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 150, clientY: 120 })

    expect(worldLayer.style.transform).toBe('translate(380px, 160px) scale(1)')
  })
})

function getWorldLayer(container: HTMLElement): HTMLElement {
  const worldLayer = container.querySelector<HTMLElement>('[data-canvas-world-layer="true"]')
  if (!worldLayer) throw new Error('Expected the infinite canvas world layer to render.')
  return worldLayer
}

const quote: InfiniteCanvasQuote = {
  id: 'quote-1',
  text: 'A sticky note should not start canvas panning.',
  color: 'yellow',
  rotationDegX100: 0,
  position: { x: 10, y: 20 },
}
