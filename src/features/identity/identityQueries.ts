import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import {
  normalizeRouteHandle,
  resolveDidToIdentity,
  resolveHandleToIdentity,
  type AtprotoIdentityError,
  type ResolvedAtprotoIdentity,
} from '../../lib/atproto/identity'

/** Query keys for ATProto handle/DID identity resolution. Keep identity cache separate from DID-scoped records. */
export const identityQueryKeys = {
  /** Root key for all identity-resolution queries. */
  all: ['identity'] as const,
  /** Identity resolved from a normalized ATProto handle. */
  handle: (handle: string) => ['identity', 'handle', normalizeRouteHandle(handle)] as const,
  /** Identity resolved from an ATProto DID document. */
  did: (did: string) => ['identity', 'did', did] as const,
} as const

/** Query hook that resolves a route handle into DID, canonical handle, and PDS endpoint. */
export function useHandleIdentityQuery(
  handle: string | null | undefined,
): UseQueryResult<ResolvedAtprotoIdentity, AtprotoIdentityError> {
  const normalizedHandle = handle ? normalizeRouteHandle(handle) : ''

  return useQuery({
    queryKey: identityQueryKeys.handle(normalizedHandle || '__missing_handle__'),
    enabled: Boolean(normalizedHandle),
    queryFn: ({ signal }) => resolveHandleToIdentity(normalizedHandle, { signal }),
  })
}

/** Query hook that resolves an active account DID into its current handle and PDS endpoint. */
export function useDidIdentityQuery(did: string | null | undefined): UseQueryResult<ResolvedAtprotoIdentity, AtprotoIdentityError> {
  return useQuery({
    queryKey: identityQueryKeys.did(did || '__missing_did__'),
    enabled: Boolean(did),
    queryFn: ({ signal }) => resolveDidToIdentity(requireDid(did), { signal }),
  })
}

function requireDid(did: string | null | undefined): string {
  if (did) return did
  throw new Error('Could not resolve DID identity. What went wrong: no DID was provided. What to do: restore the OAuth session before calling this query.')
}
