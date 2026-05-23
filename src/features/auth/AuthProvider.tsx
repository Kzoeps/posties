import type { ReactNode } from 'react'

import { useAuthQueryEventSync } from './authQueries'

/** Props for the root auth provider that keeps browser auth events synchronized with query cache state. */
export type AuthProviderProps = {
  /** App routes and UI that should react to login, logout, and account-switch events. */
  children: ReactNode
}

/**
 * Mounts ATProto auth event synchronization once near the app root.
 * Use this provider inside the TanStack Query provider so logout/account-switch
 * events can clear DID-scoped quote and settings caches across tabs.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  useAuthQueryEventSync()

  return <>{children}</>
}
