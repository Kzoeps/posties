import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'

/** Development-only TanStack devtools mounted outside the production route bundle. */
export function AppDevtools() {
  return (
    <>
      <TanStackRouterDevtools position="bottom-right" />
      <ReactQueryDevtools buttonPosition="bottom-left" initialIsOpen={false} />
    </>
  )
}
