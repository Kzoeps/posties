import { Link, createRoute, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { authQueryKeys, type ActiveAuthSessionSummary } from '../features/auth/authQueries'
import { completeOAuthCallback } from '../lib/atproto/oauthClient'
import { Route as rootRoute } from './__root'

/** OAuth callback route that exchanges the authorization response and returns users to their handle page. */
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/oauth/callback',
  component: OAuthCallbackRoute,
})

type CallbackStatus = 'completing' | 'redirecting' | 'error'

function OAuthCallbackRoute() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const completionPromiseRef = useRef<ReturnType<typeof completeOAuthCallback> | null>(null)
  const [status, setStatus] = useState<CallbackStatus>('completing')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    completionPromiseRef.current ??= completeOAuthCallback()

    completionPromiseRef.current
      .then(async (session) => {
        queryClient.setQueryData<ActiveAuthSessionSummary | null>(authQueryKeys.session(), { did: session.did })
        await queryClient.invalidateQueries({ queryKey: authQueryKeys.session() })
        if (!active) return
        setStatus('redirecting')
        await navigate({ to: '/', replace: true })
      })
      .catch((error: unknown) => {
        if (!active) return
        setStatus('error')
        setErrorMessage(toErrorMessage(error))
      })

    return () => {
      active = false
    }
  }, [navigate, queryClient])

  return (
    <section className="placeholder-page" aria-labelledby="oauth-callback-title">
      <p className="eyebrow">ATProto OAuth</p>
      <h1 id="oauth-callback-title">{status === 'error' ? 'Sign-in needs a retry' : 'Finishing sign-in'}</h1>

      {status === 'error' ? (
        <>
          <p className="quote-composer__error" role="alert">
            {errorMessage ?? 'Could not complete ATProto OAuth. Start sign-in again from the login page.'}
          </p>
          <p>
            OAuth callback links expire and can only be used once. Return to login, enter your handle, and start a fresh OAuth request.
          </p>
          <Link className="quote-button quote-button--primary" to="/login">
            Back to login
          </Link>
        </>
      ) : (
        <p role="status">
          {status === 'redirecting'
            ? 'Session restored. Opening your handle page…'
            : 'Completing the OAuth redirect and restoring your PDS session…'}
        </p>
      )}
    </section>
  )
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Could not complete ATProto OAuth. Start sign-in again from the login page.'
}
