import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { MOCK_ATPROTO_PDS_ENDPOINT, resetMockAtprotoState, seedMockHandle, seedMockQuoteRecords } from '../../test/mocks/atprotoHandlers'
import { CanvasPage } from './CanvasPage'

const OWNER_DID = 'did:plc:canvasowner'
const OWNER_HANDLE = 'alice.test'

describe('CanvasPage ownership boundary', () => {
  beforeEach(() => {
    resetMockAtprotoState({ activeDid: null })
    seedMockHandle(OWNER_HANDLE, OWNER_DID)
    seedMockQuoteRecords(OWNER_DID, [
      {
        rkey: 'public-note',
        text: 'This note is visible to everyone.',
        author: 'Alice',
        position: { x: 0, y: 0 },
        rotationDegX100: 125,
      },
    ])
  })

  it('shows owner create/edit/delete controls when the active DID owns the page', async () => {
    renderCanvas({ activeDid: OWNER_DID, isOwner: true })

    expect(screen.getByRole('button', { name: 'Add note' })).toBeTruthy()
    expect(await screen.findByText('This note is visible to everyone.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
  })

  it('keeps signed-out and non-owner viewers read-only while still showing public notes', async () => {
    renderCanvas({ activeDid: null, isOwner: false })

    expect(await screen.findByText('This note is visible to everyone.')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add note' })).toBeNull())
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })
})

function renderCanvas({ activeDid, isOwner }: { activeDid: string | null; isOwner: boolean }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  render(
    <CanvasPage
      ownerDid={OWNER_DID}
      ownerHandle={OWNER_HANDLE}
      ownerPdsEndpoint={MOCK_ATPROTO_PDS_ENDPOINT}
      activeDid={activeDid}
      isOwner={isOwner}
    />,
    { wrapper: queryWrapper(queryClient) },
  )
}

function queryWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}
