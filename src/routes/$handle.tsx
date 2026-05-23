import { Link, Navigate, createRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { AuthToolbar } from '../features/auth/AuthToolbar'
import { useActiveAuthSessionQuery } from '../features/auth/authQueries'
import { CanvasPage } from '../features/canvas/CanvasPage'
import { useHandleIdentityQuery } from '../features/identity/identityQueries'
import { normalizeRouteHandle, validateRouteHandle } from '../lib/atproto/identity'
import { Route as rootRoute } from './__root'

/** Public handle route for shareable notes pages such as `/kzoeps.com`. */
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/$handle',
  component: PublicHandleRoute,
})

function PublicHandleRoute() {
  const { handle: routeHandle } = Route.useParams()
  const normalizedHandle = normalizeRouteHandle(routeHandle)
  const validationError = getHandleValidationError(normalizedHandle)
  const sessionQuery = useActiveAuthSessionQuery()
  const identityQuery = useHandleIdentityQuery(validationError || routeHandle !== normalizedHandle ? null : normalizedHandle)

  if (validationError) {
    return <RouteErrorPage title="This path is not a notes handle" message={validationError.message} />
  }

  if (routeHandle !== normalizedHandle) {
    return <Navigate to="/$handle" params={{ handle: normalizedHandle }} replace />
  }

  if (identityQuery.isPending) {
    return (
      <section className="placeholder-page" aria-labelledby="resolve-handle-title">
        <p className="eyebrow">ATProto identity</p>
        <h1 id="resolve-handle-title">Resolving handle</h1>
        <p role="status">Looking up @{normalizedHandle}, then reading notes from that DID's public PDS repo…</p>
      </section>
    )
  }

  if (identityQuery.isError) {
    return (
      <RouteErrorPage
        title="Could not open this notes page"
        message={identityQuery.error.message}
        action={
          <button className="quote-button quote-button--ghost" type="button" onClick={() => void identityQuery.refetch()}>
            Retry handle lookup
          </button>
        }
      />
    )
  }

  const ownerIdentity = identityQuery.data
  if (ownerIdentity.handle !== normalizedHandle) {
    return <Navigate to="/$handle" params={{ handle: ownerIdentity.handle }} replace />
  }

  const activeDid = sessionQuery.data?.did ?? null
  const isOwner = activeDid === ownerIdentity.did

  return (
    <>
      <CanvasPage
        ownerDid={ownerIdentity.did}
        ownerHandle={ownerIdentity.handle}
        ownerPdsEndpoint={ownerIdentity.pdsEndpoint}
        activeDid={activeDid}
        isOwner={isOwner}
      />
      <AuthToolbar
        ownerHandle={ownerIdentity.handle}
        ownerDid={ownerIdentity.did}
        activeDid={activeDid}
        isOwner={isOwner}
        authErrorMessage={sessionQuery.isError ? sessionQuery.error.message : undefined}
      />
    </>
  )
}

type RouteErrorPageProps = {
  title: string
  message: string
  action?: ReactNode
}

function RouteErrorPage({ title, message, action }: RouteErrorPageProps) {
  return (
    <section className="placeholder-page" aria-labelledby="route-error-title">
      <p className="eyebrow">Shareable notes</p>
      <h1 id="route-error-title">{title}</h1>
      <p className="quote-composer__error" role="alert">
        {message}
      </p>
      <p>Public notes pages use ATProto handles in the first path segment, for example /alice.bsky.social.</p>
      <div className="status-actions">
        {action}
        <Link className="quote-button quote-button--primary" to="/">
          Back home
        </Link>
      </div>
    </section>
  )
}

function getHandleValidationError(handle: string): Error | null {
  try {
    validateRouteHandle(handle)
    return null
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
}
