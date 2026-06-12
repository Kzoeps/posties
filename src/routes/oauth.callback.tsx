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

  if (status !== 'error') {
    return (
      <section className="minimal-status-page" aria-labelledby="oauth-callback-title">
        <div className="minimal-status-card">
          <span className="minimal-status-dot" aria-hidden="true" />
          <h1 id="oauth-callback-title">Signing in</h1>
          <p role="status">{status === 'redirecting' ? 'Opening board' : 'One moment'}</p>
        </div>
      </section>
    )
  }

  return (
    <section className="placeholder-page" aria-labelledby="oauth-callback-title">
      <p className="eyebrow">Sign in</p>
      <h1 id="oauth-callback-title">Needs a retry</h1>
      <p className="quote-composer__error" role="alert">
        {errorMessage ?? 'Could not complete login. Start again from the login page.'}
      </p>
      <Link className="quote-button quote-button--primary" to="/login">
        Back to login
      </Link>
    </section>
  )
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Could not complete ATProto OAuth. Start sign-in again from the login page.'
}
