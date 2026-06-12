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
      <section className="minimal-status-page" aria-labelledby="restore-session-title">
        <div className="minimal-status-card">
          <span className="minimal-status-dot" aria-hidden="true" />
          <h1 id="restore-session-title">Opening board</h1>
          <p role="status">Checking session</p>
        </div>
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
    <section className="minimal-status-page" aria-labelledby="redirect-title">
      <div className="minimal-status-card">
        <span className="minimal-status-dot" aria-hidden="true" />
        <h1 id="redirect-title">Opening board</h1>
        <p role="status">Finding your handle</p>
      </div>
    </section>
  )
}

function LandingPage() {
  return (
    <section className="landing-page landing-page--signed-out" aria-labelledby="landing-title">
      <aside className="landing-page__sidebar" aria-label="Sticky Quote Canvas introduction">
        <div className="landing-page__brand-block">
          <p className="eyebrow landing-page__eyebrow">Sticky Quote Canvas</p>
          <h1 id="landing-title" className="landing-page__title">
            Sticky
            <br />
            Quote Canvas
          </h1>
          <div className="landing-page__divider" aria-hidden="true" />
          <p className="landing-page__lede">A quiet space for public notes that inspire, remind, and stay.</p>
        </div>

        <div className="landing-page__auth-block">
          <Link className="quote-button quote-button--primary landing-page__primary-action" to="/login">
            <span className="landing-page__action-icon" aria-hidden="true">
              ◈
            </span>
            Continue with Bluesky
          </Link>
          <p className="landing-page__signin-note">Sign in with your Bluesky handle using ATProto.</p>
        </div>

        <p className="auth-public-warning landing-page__public-warning" role="note">
          <span className="landing-page__warning-icon" aria-hidden="true">
            !
          </span>
          <span>
            Everything you add is public on ATProto.
            <br />
            Don&apos;t save private or sensitive content.
          </span>
        </p>

        <div className="landing-page__still-life" aria-hidden="true">
          <div className="landing-page__plant">
            <span className="landing-page__plant-stem landing-page__plant-stem--one" />
            <span className="landing-page__plant-stem landing-page__plant-stem--two" />
            <span className="landing-page__plant-stem landing-page__plant-stem--three" />
          </div>
          <div className="landing-page__vase" />
          <div className="landing-page__books">
            <span />
            <span />
          </div>
        </div>
      </aside>

      <div className="landing-page__canvas-preview" aria-hidden="true">
        <div className="landing-page__preview-note landing-page__preview-note--cream">
          “Words are, of course, the most powerful drug used by mankind.”
        </div>
        <div className="landing-page__preview-note landing-page__preview-note--blue">
          “I would always rather be happy than dignified.”
        </div>
        <div className="landing-page__preview-note landing-page__preview-note--green">“We read to know we are not alone.”</div>
      </div>
    </section>
  )
}
