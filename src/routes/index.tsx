import { Link, createRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

import { useActiveAuthSessionQuery } from '../features/auth/authQueries'
import { useDidIdentityQuery } from '../features/identity/identityQueries'
import { Route as rootRoute } from './__root'

/** Home route: signed-out landing page, signed-in redirect to the user's canonical handle page. */
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomeRoute,
})

function HomeRoute() {
  const navigate = useNavigate()
  const sessionQuery = useActiveAuthSessionQuery()
  const identityQuery = useDidIdentityQuery(sessionQuery.data?.did)
  const canonicalHandle = identityQuery.data?.handle

  useEffect(() => {
    if (!canonicalHandle) return
    void navigate({ to: '/$handle', params: { handle: canonicalHandle }, replace: true })
  }, [canonicalHandle, navigate])

  if (sessionQuery.isPending) {
    return (
      <section className="placeholder-page" aria-labelledby="restore-session-title">
        <p className="eyebrow">ATProto OAuth</p>
        <h1 id="restore-session-title">Opening your page</h1>
        <p role="status">Restoring your ATProto session before routing you to your current handle page…</p>
      </section>
    )
  }

  if (sessionQuery.isError) {
    return (
      <section className="placeholder-page" aria-labelledby="session-error-title">
        <p className="eyebrow">ATProto OAuth</p>
        <h1 id="session-error-title">Session restore failed</h1>
        <p className="quote-composer__error" role="alert">
          {sessionQuery.error.message}
        </p>
        <p>Retry the session check, or sign in again if the stored OAuth session has expired or was revoked.</p>
        <div className="status-actions">
          <button className="quote-button quote-button--ghost" type="button" onClick={() => void sessionQuery.refetch()}>
            Retry session check
          </button>
          <Link className="quote-button quote-button--primary" to="/login">
            Sign in again
          </Link>
        </div>
      </section>
    )
  }

  if (!sessionQuery.data) {
    return <LandingPage />
  }

  if (identityQuery.isError) {
    return (
      <section className="placeholder-page" aria-labelledby="identity-error-title">
        <p className="eyebrow">ATProto identity</p>
        <h1 id="identity-error-title">Handle lookup failed</h1>
        <p className="quote-composer__error" role="alert">
          {identityQuery.error.message}
        </p>
        <p>Your OAuth session is valid, but the app could not resolve your current handle from your DID document.</p>
        <div className="status-actions">
          <button className="quote-button quote-button--ghost" type="button" onClick={() => void identityQuery.refetch()}>
            Retry handle lookup
          </button>
          <Link className="quote-button quote-button--primary" to="/login">
            Sign in again
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section className="placeholder-page" aria-labelledby="redirect-title">
      <p className="eyebrow">Shareable notes</p>
      <h1 id="redirect-title">Finding your handle</h1>
      <p role="status">Resolving your DID to the current handle so your notes page uses the canonical URL…</p>
    </section>
  )
}

function LandingPage() {
  return (
    <section className="placeholder-page landing-page" aria-labelledby="landing-title">
      <div className="landing-page__copy">
        <p className="eyebrow">Sticky Quote Canvas</p>
        <h1 id="landing-title">Public notes, pinned to your handle</h1>
        <p>
          Open a shareable page like <code>/kzoeps.com</code> or <code>/alice.bsky.social</code> to read public sticky notes from that ATProto account's PDS.
        </p>
        <p>
          Sign in only when you want to create your own page. Editing controls appear exclusively on your canonical handle page.
        </p>
      </div>
      <div className="status-actions landing-page__actions">
        <Link className="quote-button quote-button--primary" to="/login">
          Sign in with ATProto
        </Link>
        <a className="quote-button quote-button--ghost" href="/kzoeps.com">
          View example path
        </a>
      </div>
      <p className="auth-public-warning" role="note">
        Public data warning: this app reads and writes public PDS records. Do not store private notes or secrets here.
      </p>
    </section>
  )
}
