import { beforeEach, describe, expect, it } from 'vitest'

import {
  extractAtprotoHandleFromDidDocument,
  extractAtprotoPdsEndpointFromDidDocument,
  normalizeRouteHandle,
  resolveDidToIdentity,
  resolveHandleToIdentity,
  validateRouteHandle,
} from './identity'
import { resetMockAtprotoState, seedMockHandle } from '../../test/mocks/atprotoHandlers'

describe('ATProto route identity helpers', () => {
  beforeEach(() => {
    resetMockAtprotoState({ activeDid: null })
  })

  it('normalizes route handles without changing the DID-backed data model', () => {
    expect(normalizeRouteHandle('@Alice.BSKY.Social.')).toBe('alice.bsky.social')
    expect(() => validateRouteHandle('alice.bsky.social')).not.toThrow()
  })

  it('rejects reserved app routes before they can be treated as handles', () => {
    expect(() => validateRouteHandle('login')).toThrow(/reserved for an app route/)
    expect(() => validateRouteHandle('oauth')).toThrow(/reserved for an app route/)
  })

  it('rejects malformed handles with actionable guidance', () => {
    expect(() => validateRouteHandle('not-a-did')).toThrow(/at least one dot/)
    expect(() => validateRouteHandle('did:plc:abc')).toThrow(/not a URL or DID/)
    expect(() => validateRouteHandle('alice..test')).toThrow(/invalid characters/)
  })

  it('extracts canonical handle and PDS endpoint from a DID document', () => {
    const didDocument = {
      id: 'did:plc:alice',
      alsoKnownAs: ['at://Alice.Test'],
      service: [
        {
          id: '#atproto_pds',
          type: 'AtprotoPersonalDataServer',
          serviceEndpoint: 'https://pds.example.com/',
        },
      ],
    }

    expect(extractAtprotoHandleFromDidDocument(didDocument)).toBe('alice.test')
    expect(extractAtprotoPdsEndpointFromDidDocument(didDocument)).toBe('https://pds.example.com')
  })

  it('resolves handles through the mock identity boundary and returns the current canonical handle', async () => {
    seedMockHandle('old-alice.test', 'did:plc:alice', { currentHandle: 'alice.test', pdsEndpoint: 'https://pds.alice.test' })

    await expect(resolveHandleToIdentity('old-alice.test')).resolves.toEqual({
      did: 'did:plc:alice',
      handle: 'alice.test',
      pdsEndpoint: 'https://pds.alice.test',
    })
    await expect(resolveDidToIdentity('did:plc:alice')).resolves.toEqual({
      did: 'did:plc:alice',
      handle: 'alice.test',
      pdsEndpoint: 'https://pds.alice.test',
    })
  })
})
