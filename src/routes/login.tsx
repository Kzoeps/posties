import { Navigate, createRoute } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'

import { LoginForm } from '../features/auth/LoginForm'
import { useActiveAuthSessionQuery } from '../features/auth/authQueries'
import { startOAuthLogin } from '../lib/atproto/oauthClient'
import { Route as rootRoute } from './__root'

/** Login route where signed-out users enter a handle to start their session. */
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
    <section className="login-page" aria-labelledby="login-title">
      <div className="login-page__panel">
        <h1 id="login-title">Enter your handle</h1>

        {sessionQuery.isPending ? (
          <p className="auth-status" role="status">
            Checking session…
          </p>
        ) : null}

        {sessionQuery.isError ? (
          <div className="quote-composer__error" role="alert">
            <p>{sessionQuery.error.message}</p>
            <button className="quote-button quote-button--ghost" type="button" onClick={() => void sessionQuery.refetch()}>
              Retry
            </button>
          </div>
        ) : null}

        <LoginForm
          disabled={sessionQuery.isPending}
          isSubmitting={loginMutation.isPending}
          errorMessage={loginMutation.isError ? toErrorMessage(loginMutation.error) : undefined}
          onSubmit={(handle) => loginMutation.mutateAsync(handle)}
        />
      </div>
    </section>
  )
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Could not start login. Check the handle and try again.'
}
