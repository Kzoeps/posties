import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { routeTree } from './routeTree.gen'
import './styles/globals.css'

/** Shared TanStack Query client for app-wide server state. */
const queryClient = new QueryClient()

/** TanStack Router instance built from the app's route tree. */
const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Could not start the app because #root was not found in index.html.')
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
