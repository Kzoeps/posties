import { Agent, XRPCError } from '@atproto/api'

import { restoreActiveOAuthSession, type ActiveOAuthSession } from './oauthClient'

/**
 * Authenticated ATProto client state returned by the app-level agent factory.
 * Feature code should use this wrapper instead of importing OAuth session types.
 */
export type AuthenticatedAtprotoAgent = {
  /** DID of the account whose OAuth session is currently active in this browser profile. */
  did: ActiveOAuthSession['did']
  /** ATProto API client configured with OAuth DPoP request signing and token refresh. */
  agent: Agent
}

/**
 * Refresh behavior to use when restoring the OAuth session before an XRPC call.
 * `auto` refreshes only when credentials are near expiry, matching the OAuth client default.
 */
export type AuthenticatedAgentRefreshMode = boolean | 'auto'

/**
 * Options accepted by `getAuthenticatedAtprotoAgent` when creating an XRPC client.
 */
export type GetAuthenticatedAtprotoAgentOptions = {
  /** Whether to refresh credentials before returning the agent; defaults to `auto`. */
  refresh?: AuthenticatedAgentRefreshMode
}

/**
 * Structured error thrown when the authenticated ATProto agent cannot be created.
 * Use `cause` for low-level OAuth/XRPC details and the message for user-facing guidance.
 */
export class AtprotoAgentError extends Error {
  /** Original error or missing-session marker that caused the wrapper to fail. */
  readonly cause?: unknown
  /** XRPC status code when the underlying SDK exposed one. */
  readonly status?: number
  /** XRPC error name when the underlying SDK exposed one. */
  readonly xrpcError?: string

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'AtprotoAgentError'
    this.cause = cause

    const details = getXrpcErrorDetails(cause)
    this.status = details.status
    this.xrpcError = details.error
  }
}

/**
 * Restores the active OAuth session and returns an ATProto API client that signs XRPC requests.
 * Call this from generic ATProto data modules; UI/feature code should prefer narrower helpers.
 */
export async function getAuthenticatedAtprotoAgent(
  options: GetAuthenticatedAtprotoAgentOptions = {},
): Promise<AuthenticatedAtprotoAgent> {
  let activeSession: ActiveOAuthSession | null

  try {
    activeSession = await restoreActiveOAuthSession(options.refresh ?? 'auto')
  } catch (error) {
    throw new AtprotoAgentError(
      'Could not create an authenticated ATProto client because the stored OAuth session could not be restored. Sign in again, then retry the request.',
      error,
    )
  }

  if (!activeSession) {
    throw new AtprotoAgentError(
      'Could not create an authenticated ATProto client because no account is signed in. Sign in with ATProto OAuth before reading or writing PDS records.',
      { error: 'MissingOAuthSession' },
    )
  }

  return {
    did: activeSession.did,
    agent: new Agent(createOAuthFetchHandler(activeSession)),
  }
}

/**
 * Creates the fetch handler used by `@atproto/api` so OAuth internals stay isolated here.
 * The handler delegates token refresh, DPoP proof signing, and nonce handling to the OAuth session.
 */
export function createOAuthFetchHandler(activeSession: ActiveOAuthSession): (url: string, init: RequestInit) => Promise<Response> {
  return (url: string, init: RequestInit) => activeSession.session.fetchHandler(url, init)
}

/**
 * Extracts XRPC status and error names from SDK errors without exposing SDK classes to callers.
 * This is useful for building actionable error messages and conflict detectors in data modules.
 */
export function getXrpcErrorDetails(error: unknown): { status?: number; error?: string; message?: string } {
  if (error instanceof XRPCError) {
    return {
      status: error.status,
      error: error.error,
      message: error.message,
    }
  }

  if (error && typeof error === 'object') {
    const maybeError = error as { status?: unknown; error?: unknown; message?: unknown; cause?: unknown }
    const direct = {
      status: typeof maybeError.status === 'number' ? maybeError.status : undefined,
      error: typeof maybeError.error === 'string' ? maybeError.error : undefined,
      message: typeof maybeError.message === 'string' ? maybeError.message : undefined,
    }

    if (direct.status !== undefined || direct.error !== undefined || direct.message !== undefined) {
      return direct
    }

    if (maybeError.cause) return getXrpcErrorDetails(maybeError.cause)
  }

  if (error instanceof Error) {
    return { message: error.message }
  }

  return {}
}
