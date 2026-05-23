import { Outlet, createRootRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

import { AuthProvider } from '../features/auth/AuthProvider'

const AppDevtools = import.meta.env.DEV
  ? lazy(() => import('../AppDevtools').then((module) => ({ default: module.AppDevtools })))
  : null

/** Root route wrapping all pages with the app shell and development-only devtools. */
export const Route = createRootRoute({
  component: RootRoute,
})

function RootRoute() {
  return (
    <>
      <AuthProvider>
        <main className="app-shell" aria-label="Sticky quote canvas app">
          <Outlet />
        </main>
      </AuthProvider>
      {AppDevtools ? (
        <Suspense fallback={null}>
          <AppDevtools />
        </Suspense>
      ) : null}
    </>
  )
}
