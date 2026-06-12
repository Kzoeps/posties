import { ATPROTO_PUBLIC_APPVIEW_SERVICE } from '../config'

/** Public Bluesky profile fields used to decorate a notes board owner without OAuth permissions. */
export type PublicBskyProfile = {
  /** Stable DID returned by the public AppView profile endpoint. */
  did: string
  /** Current Bluesky handle returned by the public AppView profile endpoint. */
  handle: string
  /** Optional public display name chosen by the account owner. */
  displayName?: string
  /** Optional public avatar URL suitable for an `<img>` source. */
  avatar?: string
}

/** Options for fetching a public Bluesky profile from the AppView. */
export type GetPublicBskyProfileOptions = {
  /** Public AppView service URL; defaults to `https://public.api.bsky.app`. */
  serviceEndpoint?: string
  /** Optional abort signal for route transitions and query cancellation. */
  signal?: AbortSignal
}

/** Error raised when the public AppView profile lookup fails or returns malformed data. */
export class AtprotoProfileError extends Error {
  /** Original fetch, JSON parsing, or validation failure. */
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'AtprotoProfileError'
    this.cause = cause
  }
}

/**
 * Fetches public Bluesky profile metadata for a handle or DID without requesting OAuth permissions.
 * Use this for decorative board chrome such as avatar, display name, and handle; it must not gate writes.
 */
export async function getPublicBskyProfile(
  actor: string,
  options: GetPublicBskyProfileOptions = {},
): Promise<PublicBskyProfile> {
  const normalizedActor = actor.trim().replace(/^@/, '')
  if (!normalizedActor) {
    throw new AtprotoProfileError('Could not fetch the public profile. What went wrong: no handle or DID was provided. What to do: pass the board owner handle or DID.')
  }

  if (shouldUseMockPublicProfile()) return buildMockPublicProfile(normalizedActor)

  const serviceEndpoint = normalizeServiceEndpoint(options.serviceEndpoint ?? ATPROTO_PUBLIC_APPVIEW_SERVICE)
  const url = new URL('/xrpc/app.bsky.actor.getProfile', serviceEndpoint)
  url.searchParams.set('actor', normalizedActor)

  let response: Response
  try {
    response = await fetch(url, { headers: { accept: 'application/json' }, signal: options.signal })
  } catch (error) {
    throw new AtprotoProfileError(
      `Could not fetch the public profile for @${normalizedActor}. What went wrong: the browser could not reach the public Bluesky AppView. What to do: keep showing the handle fallback and try again later.`,
      error,
    )
  }

  if (!response.ok) {
    throw new AtprotoProfileError(
      `Could not fetch the public profile for @${normalizedActor}. What went wrong: the public Bluesky AppView returned HTTP ${response.status}. What to do: keep showing the handle fallback and try again later.`,
    )
  }

  let data: unknown
  try {
    data = await response.json()
  } catch (error) {
    throw new AtprotoProfileError(
      `Could not read the public profile for @${normalizedActor}. What went wrong: the public Bluesky AppView returned invalid JSON. What to do: keep showing the handle fallback and try again later.`,
      error,
    )
  }

  return normalizePublicBskyProfile(data, normalizedActor)
}

function normalizePublicBskyProfile(data: unknown, actorForError: string): PublicBskyProfile {
  if (!data || typeof data !== 'object') {
    throw new AtprotoProfileError(
      `Could not use the public profile for @${actorForError}. What went wrong: the AppView response was not an object. What to do: keep showing the handle fallback and try again later.`,
    )
  }

  const profile = data as Record<string, unknown>
  const did = optionalText(profile.did)
  const handle = optionalText(profile.handle)
  if (!did || !handle) {
    throw new AtprotoProfileError(
      `Could not use the public profile for @${actorForError}. What went wrong: the AppView response did not include both DID and handle. What to do: keep showing the handle fallback and try again later.`,
    )
  }

  return {
    did,
    handle: handle.replace(/^@/, ''),
    displayName: optionalText(profile.displayName),
    avatar: optionalHttpUrl(profile.avatar),
  }
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalHttpUrl(value: unknown): string | undefined {
  const raw = optionalText(value)
  if (!raw) return undefined

  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function normalizeServiceEndpoint(rawEndpoint: string): string {
  let url: URL
  try {
    url = new URL(rawEndpoint)
  } catch {
    throw new AtprotoProfileError(
      `Could not use public AppView endpoint "${rawEndpoint}". What went wrong: it is not a valid URL. What to do: configure a valid http(s) AppView endpoint.`,
    )
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AtprotoProfileError(
      `Could not use public AppView endpoint "${rawEndpoint}". What went wrong: only http(s) endpoints can serve XRPC requests. What to do: configure a valid public AppView endpoint.`,
    )
  }

  url.pathname = url.pathname.replace(/\/$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function shouldUseMockPublicProfile(): boolean {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | boolean | undefined> }).env
  if (viteEnv?.VITE_E2E_ATPROTO_MOCK === 'true' || viteEnv?.VITE_E2E_ATPROTO_MOCK === true) return true
  if ((globalThis as { __ATPROTO_STICKY_CANVAS_E2E_MOCK__?: boolean }).__ATPROTO_STICKY_CANVAS_E2E_MOCK__ === true) return true

  try {
    return globalThis.localStorage?.getItem('atproto-sticky-canvas:mock-enabled') === 'true'
  } catch {
    return false
  }
}

function buildMockPublicProfile(actor: string): PublicBskyProfile {
  const handle = actor.startsWith('did:') ? 'alice.test' : actor
  return {
    did: actor.startsWith('did:') ? actor : 'did:plc:mockpublicprofile',
    handle,
    displayName: mockDisplayName(handle),
  }
}

function mockDisplayName(handle: string): string {
  const firstLabel = handle.split('.')[0] || handle
  return firstLabel ? `${firstLabel.slice(0, 1).toUpperCase()}${firstLabel.slice(1)}` : handle
}
