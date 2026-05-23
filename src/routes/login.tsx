import { Navigate, createRoute } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'

import { LoginForm } from '../features/auth/LoginForm'
import { useActiveAuthSessionQuery } from '../features/auth/authQueries'
import { startOAuthLogin } from '../lib/atproto/oauthClient'
import { Route as rootRoute } from './__root'

/** Login route where signed-out users start ATProto OAuth by entering a handle. */
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginRoute,
})

function LoginRoute() {
  const sessionQuery = useActiveAuthSessionQuery()
  const loginMutation = useMutation<void, Error, string>({
    mutationFn: async (handle) => {
      await startOAuthLogin({ handle })
    },
  })

  if (sessionQuery.data) {
    return <Navigate to="/" replace />
  }

  return (
    <section className="placeholder-page" aria-labelledby="login-title">
      <div className="quote-composer__header">
        <p className="eyebrow">Sticky Quote Canvas</p>
        <h1 id="login-title">Your quotes, on your PDS</h1>
        <p>
          Sign in with ATProto OAuth to open your canonical handle page. Local development uses loopback OAuth and does not need a client secret.
        </p>
      </div>

      {sessionQuery.isPending ? (
        <p className="auth-status" role="status">
          Checking for an existing ATProto session…
        </p>
      ) : null}

      {sessionQuery.isError ? (
        <div className="quote-composer__error" role="alert">
          <p>{sessionQuery.error.message}</p>
          <button className="quote-button quote-button--ghost" type="button" onClick={() => void sessionQuery.refetch()}>
            Retry session check
          </button>
        </div>
      ) : null}

      <LoginForm
        disabled={sessionQuery.isPending}
        isSubmitting={loginMutation.isPending}
        errorMessage={loginMutation.isError ? toErrorMessage(loginMutation.error) : undefined}
        onSubmit={(handle) => loginMutation.mutateAsync(handle)}
      />
    </section>
  )
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Could not start ATProto OAuth. Check the handle and try again.'
}
