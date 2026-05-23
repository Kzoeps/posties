import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { MOCK_ATPROTO_DID, resetMockAtprotoState, seedMockQuoteRecords, setMockAtprotoFailure } from '../../test/mocks/atprotoHandlers'
import { listQuoteRecords } from './quoteApi'
import {
  quoteQueryKeys,
  useCreateQuoteMutation,
  useDeleteQuoteMutation,
  useMoveQuoteMutation,
  type QuoteCacheRecord,
} from './quoteQueries'

describe('quote query mocked ATProto failure recovery', () => {
  beforeEach(() => {
    resetMockAtprotoState({ activeDid: MOCK_ATPROTO_DID })
  })

  it('rolls back a failed create mutation so the form can be retried', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData<QuoteCacheRecord[]>(quoteQueryKeys.byDid(MOCK_ATPROTO_DID), [])
    const { result } = renderHook(() => useCreateQuoteMutation(MOCK_ATPROTO_DID), { wrapper: queryWrapper(queryClient) })
    setMockAtprotoFailure('createRecord', 'network')

    let caught: unknown
    await act(async () => {
      try {
        await result.current.mutateAsync({
          text: 'Create should roll back',
          color: 'yellow',
          position: { x: 1, y: 2 },
          rotationDegX100: 100,
        })
      } catch (error) {
        caught = error
      }
    })

    expect(caught).toBeInstanceOf(Error)
    expect(queryClient.getQueryData<QuoteCacheRecord[]>(quoteQueryKeys.byDid(MOCK_ATPROTO_DID))).toEqual([])
  })

  it('restores a failed move with retry metadata instead of losing the cached note', async () => {
    const quote = await seedAndLoadOneQuote()
    const queryClient = createQueryClient()
    queryClient.setQueryData<QuoteCacheRecord[]>(quoteQueryKeys.byDid(MOCK_ATPROTO_DID), [{ ...quote, status: 'idle' }])
    const { result } = renderHook(() => useMoveQuoteMutation(MOCK_ATPROTO_DID), { wrapper: queryWrapper(queryClient) })
    setMockAtprotoFailure('putRecord', 'network')

    await act(async () => {
      try {
        await result.current.mutateAsync({ current: quote, position: { x: 90, y: 100 } })
      } catch {
        // Expected failure; assertions inspect the recoverable cache state below.
      }
    })

    const cache = queryClient.getQueryData<QuoteCacheRecord[]>(quoteQueryKeys.byDid(MOCK_ATPROTO_DID)) ?? []
    expect(cache).toHaveLength(1)
    expect(cache[0].text).toBe('Recoverable quote')
    expect(cache[0].position).toEqual({ x: 10, y: 20 })
    expect(cache[0].status).toBe('error')
    expect(cache[0].failedMutation?.action).toBe('move')
    expect(cache[0].retryLabel).toBe('Retry')
  })

  it('restores a failed delete with retry metadata instead of dropping the note silently', async () => {
    const quote = await seedAndLoadOneQuote()
    const queryClient = createQueryClient()
    queryClient.setQueryData<QuoteCacheRecord[]>(quoteQueryKeys.byDid(MOCK_ATPROTO_DID), [{ ...quote, status: 'idle' }])
    const { result } = renderHook(() => useDeleteQuoteMutation(MOCK_ATPROTO_DID), { wrapper: queryWrapper(queryClient) })
    setMockAtprotoFailure('deleteRecord', 'network')

    await act(async () => {
      try {
        await result.current.mutateAsync({ current: quote })
      } catch {
        // Expected failure; assertions inspect the recoverable cache state below.
      }
    })

    const cache = queryClient.getQueryData<QuoteCacheRecord[]>(quoteQueryKeys.byDid(MOCK_ATPROTO_DID)) ?? []
    expect(cache).toHaveLength(1)
    expect(cache[0].text).toBe('Recoverable quote')
    expect(cache[0].status).toBe('error')
    expect(cache[0].failedMutation?.action).toBe('delete')
    expect(cache[0].retryLabel).toBe('Retry')
  })
})

async function seedAndLoadOneQuote() {
  seedMockQuoteRecords(MOCK_ATPROTO_DID, [
    {
      rkey: 'recoverable',
      text: 'Recoverable quote',
      color: 'purple',
      position: { x: 10, y: 20 },
      rotationDegX100: 225,
    },
  ])
  const [quote] = await listQuoteRecords({ repo: MOCK_ATPROTO_DID })
  if (!quote) throw new Error('Expected seeded mock quote to load.')
  return quote
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function queryWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}
