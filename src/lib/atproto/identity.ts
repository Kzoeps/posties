import { Agent } from '@atproto/api'

import { ATPROTO_PUBLIC_RESOLVER_SERVICE, RESERVED_ROUTE_SEGMENTS } from '../config'

const ATPROTO_PDS_SERVICE_ID = '#atproto_pds'
const ATPROTO_PDS_SERVICE_TYPE = 'AtprotoPersonalDataServer'
const HANDLE_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const DID_PATTERN = /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/

/** DID document shape used by ATProto identity helpers after fetching a DID URL. */
export type AtprotoDidDocument = {
  /** DID subject of the document, for example `did:plc:abc...`. */
  id?: string
  /** Public aliases for the DID. ATProto DID docs normally include `at://<handle>`. */
  alsoKnownAs?: unknown
  /** DID services, including the `#atproto_pds` service endpoint used for repo reads. */
  service?: unknown
}

/** Resolved ATProto identity used by public handle pages and DID-scoped record reads. */
export type ResolvedAtprotoIdentity = {
  /** Stable account DID used as the repo identifier and TanStack Query cache scope. */
  did: string
  /** Current canonical ATProto handle from the DID document, without a leading `@`. */
  handle: string
  /** PDS service endpoint extracted from the DID document's `#atproto_pds` service. */
  pdsEndpoint: string
}

/** Options for resolving an ATProto handle into a DID-backed identity. */
export type ResolveHandleToIdentityOptions = {
  /** Public XRPC service used for `com.atproto.identity.resolveHandle`; defaults to Bluesky's resolver. */
  resolverService?: string
  /** Optional abort signal for route transitions and query cancellation. */
  signal?: AbortSignal
}

/** Options for resolving a DID document into the current handle and PDS endpoint. */
export type ResolveDidToIdentityOptions = {
  /** Optional abort signal for route transitions and query cancellation. */
  signal?: AbortSignal
}

/** Error raised by identity helpers with route-safe context and remediation guidance. */
export class AtprotoIdentityError extends Error {
  /** Identity operation that failed, such as `resolve handle` or `fetch DID document`. */
  readonly action: string
  /** Original lower-level error or invalid value. */
  readonly cause?: unknown

  constructor(action: string, message: string, cause?: unknown) {
    super(message)
    this.name = 'AtprotoIdentityError'
    this.action = action
    this.cause = cause
  }
}

/**
 * Normalizes a handle from a route segment before validation.
 * It trims whitespace, strips one leading `@`, removes one trailing dot, and lowercases the handle.
 */
export function normalizeRouteHandle(raw: string): string {
  return raw.trim().replace(/^@/, '').replace(/\.$/, '').toLowerCase()
}

/**
 * Validates that a route segment can be treated as a public ATProto handle.
 * Throws an actionable error for reserved app paths and malformed DNS-style handles.
 */
export function validateRouteHandle(handle: string): void {
  if (!handle) {
    throw new AtprotoIdentityError(
      'validate handle',
      'Could not open this notes page. What went wrong: the URL does not include an ATProto handle. What to do: open a path like /alice.bsky.social or /kzoeps.com.',
    )
  }

  const firstSegment = handle.split('/')[0]
  if (RESERVED_ROUTE_SEGMENTS.has(firstSegment)) {
    throw new AtprotoIdentityError(
      'validate handle',
      `Could not open /${handle} as a notes page. What went wrong: "${firstSegment}" is reserved for an app route. What to do: open a real ATProto handle such as /alice.bsky.social.`,
    )
  }

  if (handle.includes('/') || handle.includes('?') || handle.includes('#') || handle.includes(':')) {
    throw new AtprotoIdentityError(
      'validate handle',
      `Could not open /${handle} as a notes page. What went wrong: handles must be a single DNS-style route segment, not a URL or DID. What to do: use a handle like /alice.bsky.social.`,
    )
  }

  if (handle.length > 253 || handle.startsWith('.') || handle.endsWith('.') || !handle.includes('.')) {
    throw new AtprotoIdentityError(
      'validate handle',
      `Could not open /${handle} as a notes page. What went wrong: ATProto handles must be DNS-style names with at least one dot. What to do: use a handle like /alice.bsky.social.`,
    )
  }

  const labels = handle.split('.')
  if (labels.some((label) => !HANDLE_LABEL_PATTERN.test(label))) {
    throw new AtprotoIdentityError(
      'validate handle',
      `Could not open /${handle} as a notes page. What went wrong: one or more handle labels are empty, too long, or contain invalid characters. What to do: use letters, numbers, hyphens, and dots only.`,
    )
  }

  const topLevelLabel = labels[labels.length - 1]
  if (!/[a-z]/.test(topLevelLabel)) {
    throw new AtprotoIdentityError(
      'validate handle',
      `Could not open /${handle} as a notes page. What went wrong: the final handle label must contain a letter. What to do: use a normal ATProto handle like /alice.bsky.social.`,
    )
  }
}

/**
 * Resolves a public route handle to the owner DID, canonical handle, and PDS endpoint.
 * The returned DID should be used for repo reads, writes, and query keys; do not store the handle in quote records.
 */
export async function resolveHandleToIdentity(
  rawHandle: string,
  options: ResolveHandleToIdentityOptions = {},
): Promise<ResolvedAtprotoIdentity> {
  const handle = normalizeRouteHandle(rawHandle)
  validateRouteHandle(handle)

  const mock = await getMockIdentityBoundary()
  if (mock) return mock.mockResolveHandleToIdentity(handle)

  let did: string
  try {
    const resolver = new Agent({ service: normalizeHttpServiceEndpoint(options.resolverService ?? ATPROTO_PUBLIC_RESOLVER_SERVICE) })
    const response = await resolver.com.atproto.identity.resolveHandle({ handle }, { signal: options.signal })
    did = response.data.did
  } catch (error) {
    throw new AtprotoIdentityError(
      'resolve handle',
      `Could not resolve the ATProto handle "${handle}". What went wrong: the public identity resolver did not return a DID. What to do: check that the handle exists and try again.`,
      error,
    )
  }

  if (!isValidDid(did)) {
    throw new AtprotoIdentityError(
      'resolve handle',
      `Could not resolve the ATProto handle "${handle}". What went wrong: the resolver returned an invalid DID "${did}". What to do: check the handle and try again later.`,
    )
  }

  return resolveDidToIdentity(did, options)
}

/**
 * Resolves a DID document into the current canonical handle and PDS endpoint.
 * Use this when redirecting a signed-in user from `/` to their current `/:handle` page.
 */
export async function resolveDidToIdentity(
  did: string,
  options: ResolveDidToIdentityOptions = {},
): Promise<ResolvedAtprotoIdentity> {
  if (!isValidDid(did)) {
    throw new AtprotoIdentityError(
      'resolve DID',
      `Could not resolve account identity. What went wrong: "${did}" is not a valid DID. What to do: sign in again so the app can restore a valid ATProto account DID.`,
    )
  }

  const mock = await getMockIdentityBoundary()
  if (mock) return mock.mockResolveDidToIdentity(did)

  const didDocument = await fetchDidDocument(did, options.signal)
  const canonicalHandle = extractAtprotoHandleFromDidDocument(didDocument, did)
  const pdsEndpoint = extractAtprotoPdsEndpointFromDidDocument(didDocument, did)

  return { did, handle: canonicalHandle, pdsEndpoint }
}

/** Extracts the ATProto PDS endpoint from a DID document's `#atproto_pds` service. */
export function extractAtprotoPdsEndpointFromDidDocument(didDocument: AtprotoDidDocument, didForError = didDocument.id ?? 'unknown DID'): string {
  const services = Array.isArray(didDocument.service) ? didDocument.service : []
  const pdsService = services.find((service) => {
    if (!service || typeof service !== 'object') return false
    const candidate = service as { id?: unknown; type?: unknown }
    return candidate.id === `${didForError}${ATPROTO_PDS_SERVICE_ID}` || candidate.id === ATPROTO_PDS_SERVICE_ID || candidate.type === ATPROTO_PDS_SERVICE_TYPE
  }) as { serviceEndpoint?: unknown } | undefined

  const endpoint = Array.isArray(pdsService?.serviceEndpoint) ? pdsService?.serviceEndpoint[0] : pdsService?.serviceEndpoint
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    throw new AtprotoIdentityError(
      'parse DID document',
      `Could not find the PDS for ${didForError}. What went wrong: the DID document does not include a usable #atproto_pds serviceEndpoint. What to do: check the account DID document or try again later.`,
    )
  }

  return normalizeHttpServiceEndpoint(endpoint)
}

/** Extracts and validates the canonical ATProto handle from a DID document `alsoKnownAs` entry. */
export function extractAtprotoHandleFromDidDocument(didDocument: AtprotoDidDocument, didForError = didDocument.id ?? 'unknown DID'): string {
  const aliases = Array.isArray(didDocument.alsoKnownAs) ? didDocument.alsoKnownAs : []
  const handleAlias = aliases.find((alias): alias is string => typeof alias === 'string' && alias.startsWith('at://'))
  const handle = handleAlias ? normalizeRouteHandle(handleAlias.slice('at://'.length)) : ''

  try {
    validateRouteHandle(handle)
  } catch (error) {
    throw new AtprotoIdentityError(
      'parse DID document',
      `Could not find the current handle for ${didForError}. What went wrong: the DID document does not include a usable at:// handle alias. What to do: check the account identity and try again later.`,
      error,
    )
  }

  return handle
}

async function fetchDidDocument(did: string, signal?: AbortSignal): Promise<AtprotoDidDocument> {
  const url = didDocumentUrl(did)

  let response: Response
  try {
    response = await fetch(url, { signal, headers: { accept: 'application/did+ld+json, application/json' } })
  } catch (error) {
    throw new AtprotoIdentityError(
      'fetch DID document',
      `Could not fetch the DID document for ${did}. What went wrong: the browser could not reach ${url}. What to do: check the connection and try again.`,
      error,
    )
  }

  if (!response.ok) {
    throw new AtprotoIdentityError(
      'fetch DID document',
      `Could not fetch the DID document for ${did}. What went wrong: ${url} returned HTTP ${response.status}. What to do: try again later or check the account identity.`,
    )
  }

  try {
    return (await response.json()) as AtprotoDidDocument
  } catch (error) {
    throw new AtprotoIdentityError(
      'fetch DID document',
      `Could not read the DID document for ${did}. What went wrong: ${url} did not return valid JSON. What to do: try again later or check the DID document host.`,
      error,
    )
  }
}

function didDocumentUrl(did: string): string {
  if (did.startsWith('did:plc:')) return `https://plc.directory/${did}`

  if (did.startsWith('did:web:')) {
    const identifier = did.slice('did:web:'.length)
    const [host, ...pathParts] = identifier.split(':').map((part) => decodeURIComponent(part))
    if (!host) {
      throw new AtprotoIdentityError(
        'resolve DID',
        `Could not resolve ${did}. What went wrong: did:web is missing its hostname. What to do: sign in again or check the DID value.`,
      )
    }

    const path = pathParts.length ? `/${pathParts.map(encodeURIComponent).join('/')}/did.json` : '/.well-known/did.json'
    return `https://${host}${path}`
  }

  throw new AtprotoIdentityError(
    'resolve DID',
    `Could not resolve ${did}. What went wrong: only did:plc and did:web documents are supported for public notes pages. What to do: use an account with a resolvable ATProto DID.`,
  )
}

function normalizeHttpServiceEndpoint(rawEndpoint: string): string {
  let url: URL
  try {
    url = new URL(rawEndpoint)
  } catch {
    throw new AtprotoIdentityError(
      'normalize service endpoint',
      `Could not use ATProto service endpoint "${rawEndpoint}". What went wrong: it is not a valid URL. What to do: check the account DID document and retry.`,
    )
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AtprotoIdentityError(
      'normalize service endpoint',
      `Could not use ATProto service endpoint "${rawEndpoint}". What went wrong: only http(s) endpoints can serve XRPC requests. What to do: check the account DID document and retry.`,
    )
  }

  url.pathname = url.pathname.replace(/\/$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function isValidDid(value: string): boolean {
  return DID_PATTERN.test(value)
}

async function getMockIdentityBoundary(): Promise<typeof import('../../test/mocks/atprotoHandlers') | null> {
  if (!shouldLoadAtprotoMockBoundary()) return null
  const mock = await import('../../test/mocks/atprotoHandlers')
  return mock.isAtprotoMockRuntimeEnabled() ? mock : null
}

function shouldLoadAtprotoMockBoundary(): boolean {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | boolean | undefined> }).env
  if (viteEnv?.VITE_E2E_ATPROTO_MOCK === 'true' || viteEnv?.VITE_E2E_ATPROTO_MOCK === true) return true
  if ((globalThis as { __ATPROTO_STICKY_CANVAS_E2E_MOCK__?: boolean }).__ATPROTO_STICKY_CANVAS_E2E_MOCK__ === true) return true

  try {
    return globalThis.localStorage?.getItem('atproto-sticky-canvas:mock-enabled') === 'true'
  } catch {
    return false
  }
}
