/**
 * Domain-controlled NSID authority for this app. `kzoeps.com` is represented as
 * `com.kzoeps` in AT Protocol NSIDs.
 */
export const NSID_AUTHORITY = 'com.kzoeps' as const

/**
 * Shared NSID prefix for sticky quote canvas collections and future related
 * records owned by this application.
 */
export const STICKY_QUOTES_NSID_PREFIX = `${NSID_AUTHORITY}.stickyquotes` as const

/**
 * Collection NSID for one sticky-note quote record on a user's public PDS.
 */
export const QUOTE_COLLECTION_NSID = `${STICKY_QUOTES_NSID_PREFIX}.canvas.quote` as const

/**
 * Collection NSID for one user's canvas settings record on their public PDS.
 */
export const SETTINGS_COLLECTION_NSID = `${STICKY_QUOTES_NSID_PREFIX}.canvas.settings` as const

/**
 * Lexicon record-key mode for quote records. `tid` lets the PDS generate a
 * time-sortable record key at creation time.
 */
export const QUOTE_RECORD_KEY_MODE = 'tid' as const

/**
 * Literal record key used for the singleton settings record in each user's repo.
 */
export const SETTINGS_RECORD_KEY = 'self' as const

/**
 * Canonical collection NSIDs grouped for code that needs to iterate over app
 * collections.
 */
export const COLLECTION_NSIDS = {
  quote: QUOTE_COLLECTION_NSID,
  settings: SETTINGS_COLLECTION_NSID,
} as const
