import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { StickyNote } from './StickyNote'
import type { StickyNoteViewModel } from './quoteTypes'

describe('StickyNote', () => {
  it('renders quote text, metadata, color, and persisted rotation', () => {
    render(<StickyNote quote={baseQuote()} />)

    expect(screen.getByText('All that you touch You Change.')).toBeTruthy()
    expect(screen.getByText('— Octavia Butler')).toBeTruthy()

    const sourceLink = screen.getByRole('link', { name: 'Parable of the Sower' }) as HTMLAnchorElement
    expect(sourceLink.href).toBe('https://example.com/parable')

    const note = screen.getByRole('article', { name: 'Sticky note' }) as HTMLElement
    expect(note.className).toContain('sticky-note--purple')
    expect(note.getAttribute('data-rotation-deg-x100')).toBe('275')
    expect(note.style.getPropertyValue('--sticky-note-rotation')).toBe('2.75deg')
  })

  it('renders saving status without generating a new rotation', () => {
    render(<StickyNote quote={{ ...baseQuote(), status: 'saving', rotationDegX100: -125 }} />)

    expect(screen.getByText('Saving…')).toBeTruthy()
    const note = screen.getByRole('article', { name: 'Sticky note' }) as HTMLElement
    expect(note.className).toContain('sticky-note--status-saving')
    expect(note.getAttribute('data-rotation-deg-x100')).toBe('-125')
    expect(note.style.getPropertyValue('--sticky-note-rotation')).toBe('-1.25deg')
  })

  it('renders error state and retry action', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()

    render(
      <StickyNote
        quote={{
          ...baseQuote(),
          status: 'error',
          errorMessage: 'Could not save the latest position. Try again.',
          retryLabel: 'Apply local change to latest version',
        }}
        onRetry={onRetry}
      />,
    )

    expect(screen.getByText('Needs attention')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Could not save the latest position. Try again.')

    await user.click(screen.getByRole('button', { name: 'Apply local change to latest version' }))

    expect(onRetry).toHaveBeenCalledWith('quote-1')
  })

  it('renders non-link source text when the source URI is unsafe for anchors', () => {
    render(<StickyNote quote={{ ...baseQuote(), sourceTitle: 'Local note', sourceUri: 'notaurl' }} />)

    expect(screen.getByText('Local note')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Local note' })).toBeNull()
  })
})

function baseQuote(): StickyNoteViewModel {
  return {
    id: 'quote-1',
    text: 'All that you touch You Change.',
    author: 'Octavia Butler',
    sourceTitle: 'Parable of the Sower',
    sourceUri: 'https://example.com/parable',
    color: 'purple',
    rotationDegX100: 275,
    status: 'idle',
  }
}
