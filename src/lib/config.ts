import { QUOTE_COLLECTION_NSID, SETTINGS_COLLECTION_NSID } from './atproto/nsids'

/**
 * Public Vite environment variables that must be configured before the app can
 * start OAuth or publish a stable OAuth client metadata URL.
 */
export const PUBLIC_ENV_KEYS = {
  appOrigin: 'VITE_PUBLIC_APP_ORIGIN',
  oauthClientMetadataUrl: 'VITE_PUBLIC_OAUTH_CLIENT_METADATA_URL',
} as const

/**
 * Route paths used by TanStack Router and OAuth callback construction.
 */
export const ROUTE_PATHS = {
  home: '/',
  login: '/login',
  oauthCallback: '/oauth/callback',
} as const

/**
 * Public unauthenticated XRPC service used to resolve ATProto handles before
 * reading a user's DID-owned records from their own PDS.
 */
export const ATPROTO_PUBLIC_RESOLVER_SERVICE = 'https://bsky.social' as const

/**
 * Root path segments that belong to the app or static assets, not public handle pages.
 * Keep this centralized so future internal routes cannot be accidentally captured by `/:handle`.
 */
export const RESERVED_ROUTE_SEGMENTS: ReadonlySet<string> = new Set([
  'about',
  'api',
  'assets',
  'client-metadata.json',
  'favicon.ico',
  'login',
  'new',
  'oauth',
  'settings',
] as const)

/** Builds the canonical public notes path for an already-normalized ATProto handle. */
export function publicHandlePath(handle: string): `/${string}` {
  return `/${encodeURIComponent(handle)}`
}

/**
 * Public static paths served by Vite from the `public/` directory.
 */
export const PUBLIC_ASSET_PATHS = {
  oauthClientMetadata: '/client-metadata.json',
} as const

/**
 * App-owned AT Protocol collection NSIDs. These must match the lexicon JSON
 * files under `src/lib/atproto/lexicons/` exactly.
 */
export const ATPROTO_COLLECTIONS = {
  quote: QUOTE_COLLECTION_NSID,
  settings: SETTINGS_COLLECTION_NSID,
} as const

/**
 * Stable color values accepted by the quote lexicon and rendered by the UI.
 */
export const QUOTE_COLOR_VALUES = [
  'yellow',
  'pink',
  'blue',
  'green',
  'purple',
  'orange',
  'gray',
] as const

/**
 * App-level color token for sticky notes. Use only values from the quote
 * lexicon so records remain portable across clients.
 */
export type QuoteColor = (typeof QUOTE_COLOR_VALUES)[number]

/**
 * Render palette for each lexicon-supported sticky note color.
 */
export const QUOTE_COLOR_PALETTE: Record<
  QuoteColor,
  { label: string; background: string; border: string; shadow: string }
> = {
  yellow: { label: 'Yellow', background: '#fff4a3', border: '#e4c84f', shadow: '#c2a73d' },
  pink: { label: 'Pink', background: '#ffd3e2', border: '#e58bad', shadow: '#bf6f8f' },
  blue: { label: 'Blue', background: '#cfe8ff', border: '#7fb3dd', shadow: '#5e8db4' },
  green: { label: 'Green', background: '#d8f5c4', border: '#98c77a', shadow: '#719a58' },
  purple: { label: 'Purple', background: '#ead7ff', border: '#b994e3', shadow: '#9271bd' },
  orange: { label: 'Orange', background: '#ffd8a8', border: '#e8a85c', shadow: '#ba813f' },
  gray: { label: 'Gray', background: '#ece7dd', border: '#bbb3a6', shadow: '#91897c' },
}

/**
 * Default sticky note dimensions in canvas world pixels.
 */
export const DEFAULT_NOTE_SIZE = {
  width: 240,
  height: 180,
} as const

/**
 * Allowed sticky note size range reserved for future resizing support.
 */
export const NOTE_SIZE_LIMITS = {
  minWidth: 160,
  maxWidth: 600,
  minHeight: 120,
  maxHeight: 500,
} as const

/**
 * Gap in canvas world pixels used when placing a new note near existing notes.
 */
export const NOTE_PLACEMENT_GAP = 24 as const

/**
 * Integer world coordinate bounds used by lexicons and local validators.
 */
export const CANVAS_POSITION_LIMITS = {
  min: -1_000_000_000,
  max: 1_000_000_000,
} as const

/**
 * Zoom bounds used by the canvas viewport as floating-point UI multipliers.
 */
export const CANVAS_ZOOM_LIMITS = {
  min: 0.2,
  max: 3,
  default: 1,
} as const

/**
 * Zoom bounds stored in the settings record as fixed-point integers where
 * `1000` means `1.0x`.
 */
export const CANVAS_ZOOM_X1000_LIMITS = {
  min: 200,
  max: 3000,
  default: 1000,
} as const

/**
 * Persistent sticky note rotation bounds in hundredths of a degree.
 */
export const NOTE_ROTATION_DEG_X100_LIMITS = {
  min: -800,
  max: 800,
  createMin: -500,
  createMax: 500,
} as const

/**
 * String length limits mirrored by local validation and the quote lexicon.
 */
export const QUOTE_FIELD_LIMITS = {
  textMaxGraphemes: 2000,
  authorMaxGraphemes: 200,
  sourceTitleMaxGraphemes: 300,
  sourceUriMaxLength: 2048,
} as const

/**
 * Public environment shape consumed by `loadPublicConfig`. This narrow type
 * keeps tests and future callers from passing unrelated secret-bearing envs.
 */
export type PublicEnvSource = Partial<Record<(typeof PUBLIC_ENV_KEYS)[keyof typeof PUBLIC_ENV_KEYS], string | undefined>>

/**
 * Runtime public configuration derived from Vite environment variables.
 */
export type PublicAppConfig = {
  /** Absolute origin where this SPA is served, without a path or trailing slash. */
  appOrigin: string
  /** Absolute URL to the OAuth client metadata JSON document. */
  oauthClientMetadataUrl: string
  /** Absolute OAuth callback URL derived from `appOrigin` and route constants. */
  oauthCallbackUrl: string
  /** App route paths that feature modules should use instead of hard-coded strings. */
  routes: typeof ROUTE_PATHS
  /** AT Protocol collection NSIDs used by this app. */
  collections: typeof ATPROTO_COLLECTIONS
}

/**
 * Loads and validates public app configuration from Vite env variables.
 *
 * Throws a clear error naming the missing or invalid variable and how to fix it.
 * Use this at app startup so OAuth configuration problems fail before a user
 * reaches the login flow.
 */
export function loadPublicConfig(env: PublicEnvSource = import.meta.env as PublicEnvSource): PublicAppConfig {
  const appOrigin = normalizeOrigin(
    requirePublicEnv(
      env,
      PUBLIC_ENV_KEYS.appOrigin,
      'Set it to the loopback/dev origin that serves Vite, for example VITE_PUBLIC_APP_ORIGIN=http://127.0.0.1:5173.',
    ),
    PUBLIC_ENV_KEYS.appOrigin,
  )

  const oauthClientMetadataUrl = normalizeAbsoluteHttpUrl(
    requirePublicEnv(
      env,
      PUBLIC_ENV_KEYS.oauthClientMetadataUrl,
      `Set it to the public OAuth metadata URL, for example VITE_PUBLIC_OAUTH_CLIENT_METADATA_URL=${appOrigin}${PUBLIC_ASSET_PATHS.oauthClientMetadata}.`,
    ),
    PUBLIC_ENV_KEYS.oauthClientMetadataUrl,
  )

  return {
    appOrigin,
    oauthClientMetadataUrl,
    oauthCallbackUrl: `${appOrigin}${ROUTE_PATHS.oauthCallback}`,
    routes: ROUTE_PATHS,
    collections: ATPROTO_COLLECTIONS,
  }
}

function requirePublicEnv(env: PublicEnvSource, key: keyof PublicEnvSource & string, fix: string): string {
  const value = env[key]?.trim()
  if (!value) {
    throw new Error(`Missing public config ${key}. ${fix} Add it to .env.local for local development and to the deployment environment for production.`)
  }

  return value
}

function normalizeOrigin(rawValue: string, key: string): string {
  const url = parseHttpUrl(rawValue, key)
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Invalid public config ${key}. Expected only an origin like http://127.0.0.1:5173 with no path, query, or hash.`)
  }

  return url.origin
}

function normalizeAbsoluteHttpUrl(rawValue: string, key: string): string {
  return parseHttpUrl(rawValue, key).toString()
}

function parseHttpUrl(rawValue: string, key: string): URL {
  let url: URL
  try {
    url = new URL(rawValue)
  } catch {
    throw new Error(`Invalid public config ${key}. Expected an absolute http(s) URL, received "${rawValue}".`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Invalid public config ${key}. Expected an http(s) URL, received protocol "${url.protocol}".`)
  }

  return url
}
