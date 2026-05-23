import { beforeEach, describe, expect, it } from 'vitest'

import {
  MOCK_ATPROTO_DID,
  MOCK_ATPROTO_PDS_ENDPOINT,
  mockResolveHandleToIdentity,
  resetMockAtprotoState,
  seedMockHandle,
  seedMockQuoteRecords,
  setMockAtprotoFailure,
} from './atprotoHandlers'
import { isStaleRecordCidError } from '../../lib/atproto/records'
import {
  createQuoteRecord,
  deleteQuoteRecord,
  getCanvasSettingsRecord,
  listQuoteRecords,
  putCanvasSettingsRecord,
  updateQuoteRecord,
} from '../../features/quotes/quoteApi'

describe('mock ATProto boundary', () => {
  beforeEach(() => {
    resetMockAtprotoState({ activeDid: MOCK_ATPROTO_DID })
  })

  it('lists quote records through paginated mock listRecords calls', async () => {
    seedMockQuoteRecords(MOCK_ATPROTO_DID, [
      { rkey: 'a', text: 'First quote', position: { x: 0, y: 0 }, rotationDegX100: 100 },
      { rkey: 'b', text: 'Second quote', position: { x: 320, y: 0 }, rotationDegX100: -200 },
      { rkey: 'c', text: 'Third quote', position: { x: 640, y: 0 }, rotationDegX100: 300 },
    ])

    const quotes = await listQuoteRecords({ repo: MOCK_ATPROTO_DID, limit: 1 })

    expect(quotes.map((quote) => quote.text)).toEqual(['First quote', 'Second quote', 'Third quote'])
    expect(quotes.map((quote) => quote.rkey)).toEqual(['a', 'b', 'c'])
  })

  it('creates, updates, and deletes quote records with stable rotation and position', async () => {
    const created = await createQuoteRecord({
      repo: MOCK_ATPROTO_DID,
      text: 'A quote to persist',
      author: 'Mock Author',
      color: 'yellow',
      position: { x: 10, y: 20 },
      rotationDegX100: 250,
    })

    expect(created.rotationDegX100).toBe(250)
    expect(created.position).toEqual({ x: 10, y: 20 })

    const moved = await updateQuoteRecord({
      repo: MOCK_ATPROTO_DID,
      current: created,
      updates: { position: { x: 80, y: 120 }, text: 'Updated quote' },
    })

    expect(moved.rotationDegX100).toBe(250)
    expect(moved.position).toEqual({ x: 80, y: 120 })
    expect(moved.text).toBe('Updated quote')

    await deleteQuoteRecord({ repo: MOCK_ATPROTO_DID, rkey: moved.rkey, cid: moved.cid })

    await expect(listQuoteRecords({ repo: MOCK_ATPROTO_DID })).resolves.toEqual([])
  })

  it('surfaces stale CID conflicts from mock putRecord', async () => {
    const [seed] = seedMockQuoteRecords(MOCK_ATPROTO_DID, [
      { rkey: 'stale', cid: 'mock-cid-old', text: 'Remote quote', position: { x: 0, y: 0 }, rotationDegX100: 150 },
    ])
    const [current] = await listQuoteRecords({ repo: MOCK_ATPROTO_DID })

    let caught: unknown
    try {
      await updateQuoteRecord({
        repo: MOCK_ATPROTO_DID,
        current: { ...current, cid: 'stale-client-cid' },
        updates: { text: 'Local edit' },
      })
    } catch (error) {
      caught = error
    }

    expect(isStaleRecordCidError(caught)).toBe(true)
    expect(seed.cid).toBe('mock-cid-old')
  })

  it('surfaces one-shot network failures and then recovers on retry', async () => {
    setMockAtprotoFailure('createRecord', 'network')

    await expect(
      createQuoteRecord({
        repo: MOCK_ATPROTO_DID,
        text: 'First attempt fails',
        color: 'blue',
        position: { x: 0, y: 0 },
        rotationDegX100: 120,
      }),
    ).rejects.toThrow(/Mock network failure/)

    const created = await createQuoteRecord({
      repo: MOCK_ATPROTO_DID,
      text: 'Second attempt works',
      color: 'blue',
      position: { x: 0, y: 0 },
      rotationDegX100: 120,
    })

    expect(created.text).toBe('Second attempt works')
  })

  it('resolves seeded handles and reads public quote records without an active mock session', async () => {
    const ownerDid = 'did:plc:publicalice'
    resetMockAtprotoState({ activeDid: null })
    seedMockHandle('alice.test', ownerDid)
    seedMockQuoteRecords(ownerDid, [{ rkey: 'public', text: 'Public page quote', rotationDegX100: 50 }])

    await expect(mockResolveHandleToIdentity('alice.test')).resolves.toMatchObject({ did: ownerDid, handle: 'alice.test' })
    const quotes = await listQuoteRecords({ repo: ownerDid, auth: 'public', serviceEndpoint: MOCK_ATPROTO_PDS_ENDPOINT })

    expect(quotes.map((quote) => quote.text)).toEqual(['Public page quote'])
  })

  it('reads and writes the singleton settings record', async () => {
    await putCanvasSettingsRecord({
      repo: MOCK_ATPROTO_DID,
      settings: {
        defaultColor: 'green',
        lastViewport: { x: 12, y: -34, zoomX1000: 1250 },
      },
    })

    const settings = await getCanvasSettingsRecord({ repo: MOCK_ATPROTO_DID })

    expect(settings?.rkey).toBe('self')
    expect(settings?.defaultColor).toBe('green')
    expect(settings?.lastViewport).toEqual({ x: 12, y: -34, zoomX1000: 1250 })
  })
})
