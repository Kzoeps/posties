import {
  buildAtprotoLoopbackClientId,
  OAuthClient,
  type AtprotoDid,
  type OAuthClientMetadataInput,
  type OAuthRedirectUri,
  type OAuthResponseMode,
  type OAuthSession,
  type RuntimeImplementation,
} from '@atproto/oauth-client'

import { loadPublicConfig } from '../config'
import {
  clearActiveDid,
  createBrowserDpopKey,
  deleteLocalSession,
  dpopNonceStore,
  getActiveDid,
  oauthSessionStore,
  oauthStateStore,
  setActiveDid,
} from './sessionStore'

const HANDLE_RESOLVER_SERVICE = 'https://bsky.social'
const OAUTH_RESPONSE_MODE: OAuthResponseMode = 'query'
const OAUTH_SCOPE = 'atproto repo:com.kzoeps.stickyquotes.canvas.quote'
const CALLBACK_PATH = '/oauth/callback'
const PRODUCTION_CLIENT_METADATA_URL = 'https://posties.kzoeps.com/client-metadata.json'

let oauthClient: OAuthClient | undefined
const memoryLocks = new Map<string, Promise<unknown>>()

/** Summary returned to app code after restoring or completing an OAuth session. */
export type ActiveOAuthSession = {
  did: AtprotoDid
  session: OAuthSession
}

/** Options for starting a handle-based ATProto OAuth login. */
export type StartOAuthLoginOptions = {
  handle: string
  appState?: string
  signal?: AbortSignal
}

/** Options for completing an OAuth callback route. */
export type CompleteOAuthCallbackOptions = {
  callbackUrl?: string | URL
}

/** Error raised by app-level OAuth helpers with guidance for users/developers. */
export class AtprotoOAuthError extends Error {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'AtprotoOAuthError'
    this.cause = cause
  }
}

/** Returns the singleton ATProto OAuth client configured for local loopback or production metadata. */
export function getAtprotoOAuthClient(): OAuthClient {
  assertBrowserOAuthRuntime()
  oauthClient ??= new OAuthClient({
    responseMode: OAUTH_RESPONSE_MODE,
    clientMetadata: buildOAuthClientMetadata(),
    handleResolver: HANDLE_RESOLVER_SERVICE,
    stateStore: oauthStateStore,
    sessionStore: oauthSessionStore,
    dpopNonceCache: dpopNonceStore,
    runtimeImplementation: createBrowserRuntime(),
    onUpdate: (did) => {
      void setActiveDid(did).catch((error: unknown) => {
        console.error(formatOAuthError('Could not update the active DID after OAuth token refresh.', error))
      })
    },
    onDelete: (did, cause) => {
      void deleteLocalSession(did).catch((error: unknown) => {
        console.error(formatOAuthError('Could not delete the local OAuth session after the server rejected it.', error))
      })
      console.warn(formatOAuthError(`OAuth session for ${did} was removed. Sign in again to continue.`, cause))
    },
  })

  return oauthClient
}

/** Builds an authorization URL for a handle without navigating the browser. */
export async function createOAuthAuthorizationUrl({
  handle,
  appState,
  signal,
}: StartOAuthLoginOptions): Promise<URL> {
  const normalizedHandle = normalizeHandle(handle)
  const redirectUri = getOAuthRedirectUri()

  try {
    return getAtprotoOAuthClient().authorize(normalizedHandle, {
      redirect_uri: redirectUri,
      scope: OAUTH_SCOPE,
      state: appState,
      signal,
    })
  } catch (error) {
    throw new AtprotoOAuthError(
      `Could not start ATProto OAuth for "${normalizedHandle}". Check that the handle is valid and that the PDS supports OAuth.`,
      error,
    )
  }
}

/** Starts handle-based ATProto OAuth by assigning `window.location` to the authorization URL. */
export async function startOAuthLogin(options: StartOAuthLoginOptions): Promise<never> {
  const mock = await getMockOAuthBoundary()
  if (mock) return mock.mockStartOAuthLogin(options)

  assertBrowserOAuthRuntime()
  const authorizationUrl = await createOAuthAuthorizationUrl(options)
  window.location.assign(authorizationUrl)

  return new Promise<never>(() => {
    // Navigation intentionally leaves this page.
  })
}

/** Completes the OAuth callback, stores the active DID, and returns the restored session. */
export async function completeOAuthCallback(options: CompleteOAuthCallbackOptions = {}): Promise<ActiveOAuthSession> {
  const mock = await getMockOAuthBoundary()
  if (mock) return mock.mockCompleteOAuthCallback() as Promise<ActiveOAuthSession>

  const callbackUrl = new URL(options.callbackUrl ?? window.location.href)
  const params = getCallbackParams(callbackUrl)

  try {
    const result = await getAtprotoOAuthClient().callback(params, {
      redirect_uri: getOAuthRedirectUri(),
    })
    await setActiveDid(result.session.did)

    return {
      did: result.session.did,
      session: result.session,
    }
  } catch (error) {
    throw new AtprotoOAuthError(
      'Could not complete ATProto OAuth callback. The redirect may be stale, already used, or missing stored PKCE/DPoP state. Try signing in again.',
      error,
    )
  }
}

/** Restores the active OAuth session from IndexedDB, refreshing credentials when needed. */
export async function restoreActiveOAuthSession(refresh: boolean | 'auto' = 'auto'): Promise<ActiveOAuthSession | null> {
  const mock = await getMockOAuthBoundary()
  if (mock) return mock.mockRestoreActiveOAuthSession() as Promise<ActiveOAuthSession | null>

  const did = await getActiveDid()
  if (!did) return null

  try {
    const session = await getAtprotoOAuthClient().restore(did, refresh)
    return {
      did: session.did,
      session,
    }
  } catch (error) {
    await deleteLocalSession(did)
    throw new AtprotoOAuthError(
      `Could not restore the OAuth session for ${did}. The stored token may be expired, revoked, or corrupted. Sign in again.`,
      error,
    )
  }
}

/** Revokes the active OAuth session when possible, then clears local session and active-account state. */
export async function logoutActiveOAuthSession(): Promise<void> {
  const mock = await getMockOAuthBoundary()
  if (mock) {
    await mock.mockLogoutActiveOAuthSession()
    return
  }

  const did = await getActiveDid()
  if (!did) {
    await clearActiveDid()
    return
  }

  try {
    await getAtprotoOAuthClient().revoke(did)
  } catch (error) {
    console.warn(formatOAuthError(`Could not revoke OAuth tokens for ${did}; clearing the local session anyway.`, error))
  } finally {
    await deleteLocalSession(did)
    await clearActiveDid()
  }
}

/** Returns the redirect URI matching local loopback development or deployed production config. */
export function getOAuthRedirectUri(): OAuthRedirectUri {
  assertBrowserOAuthRuntime()
  if (isLoopbackOrigin(window.location.origin)) return getLoopbackRedirectUri()

  return loadPublicConfig().oauthCallbackUrl as OAuthRedirectUri
}

/** Returns the loopback redirect URI matching the current dev server origin. */
export function getLoopbackRedirectUri(): OAuthRedirectUri {
  assertBrowserOAuthRuntime()
  const redirectUri = new URL(CALLBACK_PATH, window.location.origin)

  if (redirectUri.hostname === 'localhost') {
    redirectUri.hostname = '127.0.0.1'
  }

  if (!isLoopbackOrigin(redirectUri.origin)) {
    throw new AtprotoOAuthError(
      `Local OAuth loopback mode requires localhost, 127.0.0.1, or [::1], but the app is running on ${window.location.origin}. Use a loopback dev URL or configure production metadata first.`,
    )
  }

  return redirectUri.toString() as OAuthRedirectUri
}

/** Returns the production client metadata URL that must be hosted before non-loopback deployment. */
export function getProductionClientMetadataUrl(): string {
  return PRODUCTION_CLIENT_METADATA_URL
}

/** Returns the OAuth scope centralized for loopback and production metadata. */
export function getAtprotoOAuthScope(): string {
  return OAUTH_SCOPE
}

function buildOAuthClientMetadata(): OAuthClientMetadataInput {
  const redirectUri = getOAuthRedirectUri()

  if (isLoopbackOrigin(window.location.origin)) {
    return {
      client_id: buildAtprotoLoopbackClientId({
        scope: OAUTH_SCOPE,
        redirect_uris: [redirectUri],
      }),
      client_name: 'Sticky Quote Canvas (development)',
      client_uri: window.location.origin,
      redirect_uris: [redirectUri],
      scope: OAUTH_SCOPE,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: 'native',
      token_endpoint_auth_method: 'none',
      dpop_bound_access_tokens: true,
    }
  }

  const config = loadPublicConfig()
  return {
    client_id: config.oauthClientMetadataUrl,
    client_name: 'Sticky Quote Canvas',
    client_uri: config.appOrigin,
    redirect_uris: [redirectUri],
    scope: OAUTH_SCOPE,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    application_type: 'web',
    token_endpoint_auth_method: 'none',
    dpop_bound_access_tokens: true,
  }
}

function createBrowserRuntime(): RuntimeImplementation {
  return {
    createKey: createBrowserDpopKey,
    getRandomValues(length) {
      assertBrowserOAuthRuntime()
      return crypto.getRandomValues(new Uint8Array(length))
    },
    async digest(bytes, algorithm) {
      assertBrowserOAuthRuntime()
      const digest = await crypto.subtle.digest(toSubtleDigestName(algorithm.name), bytes)
      return new Uint8Array(digest)
    },
    requestLock(name, fn) {
      return withBrowserLock(name, fn)
    },
  }
}

async function withBrowserLock<T>(name: string, fn: () => T | PromiseLike<T>): Promise<T> {
  const lockManager = globalThis.navigator?.locks
  if (lockManager) {
    return lockManager.request(`atproto-sticky-canvas:${name}`, () => Promise.resolve(fn()))
  }

  const previous = memoryLocks.get(name) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.then(() => current)
  memoryLocks.set(name, queued)

  await previous
  try {
    return await fn()
  } finally {
    release()
    if (memoryLocks.get(name) === queued) {
      memoryLocks.delete(name)
    }
  }
}

function getCallbackParams(callbackUrl: URL): URLSearchParams {
  if (callbackUrl.searchParams.size > 0) return callbackUrl.searchParams
  if (callbackUrl.hash.startsWith('#')) return new URLSearchParams(callbackUrl.hash.slice(1))

  throw new AtprotoOAuthError('OAuth callback URL has no query or hash parameters. Start login again from the app.')
}

function normalizeHandle(handle: string): string {
  const normalized = handle.trim().replace(/^@/, '').toLowerCase()
  if (!normalized) {
    throw new AtprotoOAuthError('Enter an ATProto handle before starting OAuth login.')
  }

  return normalized
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
  } catch {
    return false
  }
}

function toSubtleDigestName(name: 'sha256' | 'sha384' | 'sha512'): AlgorithmIdentifier {
  switch (name) {
    case 'sha256':
      return 'SHA-256'
    case 'sha384':
      return 'SHA-384'
    case 'sha512':
      return 'SHA-512'
  }
}

function assertBrowserOAuthRuntime(): void {
  if (typeof window === 'undefined' || !globalThis.crypto?.subtle) {
    throw new AtprotoOAuthError('ATProto OAuth requires a browser runtime with WebCrypto support.')
  }
}

async function getMockOAuthBoundary(): Promise<typeof import('../../test/mocks/atprotoHandlers') | null> {
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

function formatOAuthError(message: string, error: unknown): string {
  if (error instanceof Error) return `${message} Cause: ${error.message}`
  return `${message} Cause: ${String(error)}`
}
