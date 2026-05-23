import { useEffect } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import { logoutActiveOAuthSession, restoreActiveOAuthSession } from '../../lib/atproto/oauthClient'
import { subscribeAuthEvents, type AuthSessionEvent } from '../../lib/atproto/sessionStore'

const ACCOUNT_SCOPED_QUERY_PREFIXES = ['quotes', 'canvasSettings'] as const

/** Query keys for authentication state. Use these instead of ad-hoc auth cache keys. */
export const authQueryKeys = {
  /** Root key for all authentication-related query data. */
  all: ['auth'] as const,
  /** Active OAuth session summary restored from the browser OAuth stores. */
  session: () => ['auth', 'session'] as const,
} as const

/** Lightweight auth state safe to keep in TanStack Query without exposing token material to UI code. */
export type ActiveAuthSessionSummary = {
  /** DID of the account currently selected in this browser profile. */
  did: string
}

/** Context returned by the logout mutation so failed local cleanup can restore visible auth state. */
export type LogoutMutationContext = {
  /** Account DID that was active before the optimistic logout cache update. */
  previousDid: string | null
}

/** Error thrown by auth query hooks with an actionable user/developer remediation. */
export class AuthQueryError extends Error {
  /** Auth action that failed, such as `restore session` or `logout`. */
  readonly action: string
  /** Original lower-level OAuth or storage error. */
  readonly cause?: unknown

  constructor(action: string, message: string, cause?: unknown) {
    super(message)
    this.name = 'AuthQueryError'
    this.action = action
    this.cause = cause
  }
}

/** Restores the active OAuth session and returns only the DID summary needed by UI and query scoping. */
export async function restoreActiveAuthSessionSummary(): Promise<ActiveAuthSessionSummary | null> {
  try {
    const activeSession = await restoreActiveOAuthSession('auto')
    return activeSession ? { did: activeSession.did } : null
  } catch (error) {
    throw toAuthQueryError(
      'restore session',
      'Could not restore the ATProto OAuth session. What went wrong: the stored session could not be loaded or refreshed. What to do: sign in again, then retry the action.',
      error,
    )
  }
}

/** Query hook for the active OAuth session summary, keyed as `['auth', 'session']`. */
export function useActiveAuthSessionQuery(): UseQueryResult<ActiveAuthSessionSummary | null, AuthQueryError> {
  return useQuery({
    queryKey: authQueryKeys.session(),
    queryFn: restoreActiveAuthSessionSummary,
  })
}

/**
 * Mutation hook for logging out the active ATProto account.
 * It clears DID-scoped quote/settings query data optimistically and invalidates auth state after cleanup.
 */
export function useLogoutActiveAuthSessionMutation(): UseMutationResult<void, AuthQueryError, void, LogoutMutationContext> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      try {
        await logoutActiveOAuthSession()
      } catch (error) {
        throw toAuthQueryError(
          'logout',
          'Could not log out of ATProto OAuth cleanly. What went wrong: local session storage could not be cleared. What to do: retry logout; if it still fails, clear site data for this app.',
          error,
        )
      }
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: authQueryKeys.session() })
      const previousSession = queryClient.getQueryData<ActiveAuthSessionSummary | null>(authQueryKeys.session())
      queryClient.setQueryData<ActiveAuthSessionSummary | null>(authQueryKeys.session(), null)
      clearAccountScopedQueries(queryClient, previousSession?.did)

      return { previousDid: previousSession?.did ?? null }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousDid) {
        queryClient.setQueryData<ActiveAuthSessionSummary | null>(authQueryKeys.session(), { did: context.previousDid })
      }
    },
    onSuccess: () => {
      clearAccountScopedQueries(queryClient)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: authQueryKeys.session() })
    },
  })
}

/**
 * React hook that keeps auth and DID-scoped caches synchronized with login/logout events from other tabs.
 * Mount it once near the app root when protected routes are wired in.
 */
export function useAuthQueryEventSync(): void {
  const queryClient = useQueryClient()

  useEffect(() => subscribeAuthEvents((event) => syncAuthEventWithQueryClient(queryClient, event)), [queryClient])
}

/** Applies one auth storage/BroadcastChannel event to TanStack Query caches. */
export function syncAuthEventWithQueryClient(queryClient: QueryClient, event: AuthSessionEvent): void {
  if (event.previousDid && event.previousDid !== event.did) {
    clearAccountScopedQueries(queryClient, event.previousDid)
  }

  if ((event.type === 'logout' || event.type === 'session-delete') && event.did) {
    clearAccountScopedQueries(queryClient, event.did)
  }

  if (event.type === 'logout' && !event.did) {
    clearAccountScopedQueries(queryClient, event.previousDid)
    queryClient.setQueryData<ActiveAuthSessionSummary | null>(authQueryKeys.session(), null)
  }

  void queryClient.invalidateQueries({ queryKey: authQueryKeys.session() })
}

/** Removes quote and canvas-settings query data for one DID, or all account-scoped data when no DID is provided. */
export function clearAccountScopedQueries(queryClient: QueryClient, did?: string | null): void {
  for (const prefix of ACCOUNT_SCOPED_QUERY_PREFIXES) {
    if (did) {
      queryClient.removeQueries({ queryKey: [prefix, did], exact: true })
    } else {
      queryClient.removeQueries({ queryKey: [prefix] })
    }
  }
}

function toAuthQueryError(action: string, message: string, cause: unknown): AuthQueryError {
  if (cause instanceof AuthQueryError) return cause
  return new AuthQueryError(action, message, cause)
}
