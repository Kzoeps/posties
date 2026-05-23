import {
  Key,
  type InternalStateData,
  type JwtHeader,
  type JwtPayload,
  type PrivateJwk,
  type Session,
  type SessionStore,
  type SignedJwt,
  type StateStore,
  type VerifyOptions,
  type VerifyResult,
} from '@atproto/oauth-client'

const DB_NAME = 'atproto-sticky-canvas-oauth'
const DB_VERSION = 1
const STATE_STORE_NAME = 'oauth-state'
const SESSION_STORE_NAME = 'oauth-sessions'
const META_STORE_NAME = 'app-meta'
const DPOP_NONCE_STORE_NAME = 'dpop-nonces'
const ACTIVE_DID_KEY = 'active-did'
const STATE_TTL_MS = 60 * 60 * 1000
const AUTH_EVENT_CHANNEL = 'atproto-sticky-canvas-auth'
const AUTH_EVENT_STORAGE_KEY = 'atproto-sticky-canvas-auth-event'

type StoredValue<T> = {
  createdAt: number
  value: T
}

type StoredPrivateKey = {
  kind: 'webcrypto-p256-private-jwk'
  jwk: PrivateJwk
}

type StoredSession = Omit<Session, 'dpopKey'> & {
  dpopKey: StoredPrivateKey
}

type StoredState = Omit<InternalStateData, 'dpopKey'> & {
  dpopKey: StoredPrivateKey
}

/** Event emitted when another tab logs in, logs out, or changes the active account. */
export type AuthSessionEvent = {
  type: 'login' | 'logout' | 'account-switch' | 'session-delete'
  did: string | null
  previousDid?: string | null
  createdAt: string
}

/** Error raised when the browser cannot persist OAuth state safely enough to continue. */
export class OAuthStorageError extends Error {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'OAuthStorageError'
    this.cause = cause
  }
}

/** P-256 WebCrypto-backed key used by `@atproto/oauth-client` for DPoP JWT signing. */
export class BrowserP256Key extends Key<PrivateJwk> {
  private constructor(
    jwk: PrivateJwk,
    private readonly privateKey: CryptoKey,
    private publicKeyPromise?: Promise<CryptoKey>,
  ) {
    super(Object.freeze(jwk))
  }

  /** Creates a new ES256 private key for OAuth DPoP proof signing. */
  static async generate(): Promise<BrowserP256Key> {
    assertWebCrypto()

    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )

    const exported = await crypto.subtle.exportKey('jwk', keyPair.privateKey)
    const jwk = normalizePrivateJwk(exported, randomKeyId())
    return new BrowserP256Key(jwk, keyPair.privateKey, Promise.resolve(keyPair.publicKey))
  }

  /** Recreates an ES256 private key from the IndexedDB-stored JWK. */
  static async fromStored(stored: StoredPrivateKey): Promise<BrowserP256Key> {
    if (stored.kind !== 'webcrypto-p256-private-jwk') {
      throw new OAuthStorageError(
        `Unsupported stored DPoP key kind "${stored.kind}". Clear site data and sign in again.`,
      )
    }

    return BrowserP256Key.fromPrivateJwk(stored.jwk)
  }

  /** Imports an ES256 private JWK into WebCrypto and wraps it as an OAuth client key. */
  static async fromPrivateJwk(jwk: PrivateJwk): Promise<BrowserP256Key> {
    assertWebCrypto()
    assertP256PrivateJwk(jwk)

    const privateKey = await crypto.subtle.importKey(
      'jwk',
      jwk as JsonWebKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign'],
    )

    return new BrowserP256Key(Object.freeze({ ...jwk }), privateKey)
  }

  /** Serializes the key into a durable IndexedDB value. */
  toStored(): StoredPrivateKey {
    return {
      kind: 'webcrypto-p256-private-jwk',
      jwk: this.jwk,
    }
  }

  /** Creates a compact ES256 JWT used by OAuth DPoP requests. */
  async createJwt(header: JwtHeader, payload: JwtPayload): Promise<SignedJwt> {
    const protectedHeader = {
      ...header,
      alg: header.alg ?? 'ES256',
      jwk: header.jwk ?? this.publicJwk,
      kid: header.kid ?? this.kid,
    }
    const signingInput = `${base64UrlJson(protectedHeader)}.${base64UrlJson(payload)}`
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      this.privateKey,
      new TextEncoder().encode(signingInput),
    )

    return `${signingInput}.${base64UrlBytes(new Uint8Array(signature))}` as SignedJwt
  }

  /** Verifies an ES256 JWT signed by this key and returns its decoded header and payload. */
  async verifyJwt<C extends string = never>(
    token: SignedJwt,
    _options?: VerifyOptions<C>,
  ): Promise<VerifyResult<C>> {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.')
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      throw new OAuthStorageError('Cannot verify JWT because it is not a three-part signed token.')
    }

    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      await this.getPublicCryptoKey(),
      bytesToArrayBuffer(base64UrlToBytes(encodedSignature)),
      bytesToArrayBuffer(new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)),
    )

    if (!valid) {
      throw new OAuthStorageError('Cannot verify JWT because the ES256 signature is invalid.')
    }

    return {
      protectedHeader: parseBase64UrlJson<JwtHeader>(encodedHeader),
      payload: parseBase64UrlJson<VerifyResult<C>['payload']>(encodedPayload),
    }
  }

  private async getPublicCryptoKey(): Promise<CryptoKey> {
    this.publicKeyPromise ??= crypto.subtle.importKey(
      'jwk',
      this.publicJwk as JsonWebKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify'],
    )

    return this.publicKeyPromise
  }
}

/** IndexedDB-backed OAuth state store used while the user is away at the authorization server. */
export const oauthStateStore: StateStore = {
  async get(key) {
    const stored = await readStoredValue<StoredState>(STATE_STORE_NAME, key)
    if (!stored) return undefined

    if (Date.now() - stored.createdAt > STATE_TTL_MS) {
      await deleteValue(STATE_STORE_NAME, key)
      return undefined
    }

    return deserializeState(stored.value)
  },
  async set(key, value) {
    await writeStoredValue<StoredState>(STATE_STORE_NAME, key, await serializeState(value))
  },
  async del(key) {
    await deleteValue(STATE_STORE_NAME, key)
  },
}

/** IndexedDB-backed OAuth session store containing refresh tokens and DPoP key material. */
export const oauthSessionStore: SessionStore = {
  async get(did) {
    const stored = await readStoredValue<StoredSession>(SESSION_STORE_NAME, did)
    return stored ? deserializeSession(stored.value) : undefined
  },
  async set(did, value) {
    await writeStoredValue<StoredSession>(SESSION_STORE_NAME, did, serializeSession(value))
  },
  async del(did) {
    await deleteValue(SESSION_STORE_NAME, did)
    publishAuthEvent({ type: 'session-delete', did, createdAt: new Date().toISOString() })
  },
}

/** IndexedDB-backed cache for DPoP nonces returned by OAuth resource servers. */
export const dpopNonceStore = {
  async get(key: string): Promise<string | undefined> {
    const stored = await readStoredValue<string>(DPOP_NONCE_STORE_NAME, key)
    return stored?.value
  },
  async set(key: string, value: string): Promise<void> {
    await writeStoredValue<string>(DPOP_NONCE_STORE_NAME, key, value)
  },
  async del(key: string): Promise<void> {
    await deleteValue(DPOP_NONCE_STORE_NAME, key)
  },
}

/** Returns the DID selected as the active account for this browser profile. */
export async function getActiveDid(): Promise<string | null> {
  const stored = await readStoredValue<string>(META_STORE_NAME, ACTIVE_DID_KEY)
  return stored?.value ?? null
}

/** Sets the active account DID and notifies other tabs so UI caches can react. */
export async function setActiveDid(did: string): Promise<void> {
  const previousDid = await getActiveDid()
  await writeStoredValue<string>(META_STORE_NAME, ACTIVE_DID_KEY, did)

  if (previousDid === did) return

  publishAuthEvent({
    type: previousDid ? 'account-switch' : 'login',
    did,
    previousDid,
    createdAt: new Date().toISOString(),
  })
}

/** Clears the active DID without deleting stored sessions and notifies other tabs. */
export async function clearActiveDid(): Promise<void> {
  const previousDid = await getActiveDid()
  await deleteValue(META_STORE_NAME, ACTIVE_DID_KEY)
  publishAuthEvent({ type: 'logout', did: null, previousDid, createdAt: new Date().toISOString() })
}

/** Deletes one locally stored OAuth session without contacting the authorization server. */
export async function deleteLocalSession(did: string): Promise<void> {
  await oauthSessionStore.del(did)
  if ((await getActiveDid()) === did) {
    await clearActiveDid()
  }
}

/** Subscribes to auth changes from this tab, BroadcastChannel, and storage-event fallback. */
export function subscribeAuthEvents(listener: (event: AuthSessionEvent) => void): () => void {
  const localListener = (event: Event) => listener((event as CustomEvent<AuthSessionEvent>).detail)
  authEventTarget.addEventListener(AUTH_EVENT_CHANNEL, localListener)

  const channel = getBroadcastChannel()
  const channelListener = (event: MessageEvent<AuthSessionEvent>) => listener(event.data)
  channel?.addEventListener('message', channelListener)

  const storageListener = (event: StorageEvent) => {
    if (event.key !== AUTH_EVENT_STORAGE_KEY || !event.newValue) return
    listener(JSON.parse(event.newValue) as AuthSessionEvent)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', storageListener)
  }

  return () => {
    authEventTarget.removeEventListener(AUTH_EVENT_CHANNEL, localListener)
    channel?.removeEventListener('message', channelListener)
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', storageListener)
    }
  }
}

/** Creates a DPoP signing key for the OAuth runtime, preferring ES256 as required by browser WebCrypto. */
export async function createBrowserDpopKey(algs: string[]): Promise<Key> {
  if (!algs.includes('ES256')) {
    throw new OAuthStorageError(
      `The OAuth server requested unsupported DPoP algorithms (${algs.join(', ')}). This browser client currently supports ES256 only.`,
    )
  }

  return BrowserP256Key.generate()
}

function serializeSession(session: Session): StoredSession {
  return {
    ...session,
    dpopKey: serializeKey(session.dpopKey),
  }
}

async function deserializeSession(stored: StoredSession): Promise<Session> {
  return {
    ...stored,
    dpopKey: await BrowserP256Key.fromStored(stored.dpopKey),
  }
}

async function serializeState(state: InternalStateData): Promise<StoredState> {
  return {
    ...state,
    dpopKey: serializeKey(state.dpopKey),
  }
}

async function deserializeState(stored: StoredState): Promise<InternalStateData> {
  return {
    ...stored,
    dpopKey: await BrowserP256Key.fromStored(stored.dpopKey),
  }
}

function serializeKey(key: Key): StoredPrivateKey {
  if (key instanceof BrowserP256Key) return key.toStored()

  const privateJwk = key.privateJwk
  if (!privateJwk) {
    throw new OAuthStorageError(
      'Cannot persist the OAuth DPoP key because the runtime returned a non-private key. Clear site data and sign in again.',
    )
  }

  return {
    kind: 'webcrypto-p256-private-jwk',
    jwk: privateJwk,
  }
}

function publishAuthEvent(event: AuthSessionEvent): void {
  authEventTarget.dispatchEvent(new CustomEvent(AUTH_EVENT_CHANNEL, { detail: event }))
  getBroadcastChannel()?.postMessage(event)

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(AUTH_EVENT_STORAGE_KEY, JSON.stringify(event))
    } catch {
      // Storage events are a fallback only. BroadcastChannel/local listeners still work.
    }
  }
}

const authEventTarget = new EventTarget()
let broadcastChannel: BroadcastChannel | null | undefined

function getBroadcastChannel(): BroadcastChannel | null {
  if (broadcastChannel !== undefined) return broadcastChannel
  broadcastChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(AUTH_EVENT_CHANNEL)
  return broadcastChannel
}

let dbPromise: Promise<IDBDatabase> | undefined

function getDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  if (typeof indexedDB === 'undefined') {
    throw new OAuthStorageError(
      'IndexedDB is unavailable, so OAuth login cannot persist redirect state or refresh tokens. Use a browser profile with IndexedDB enabled and try again.',
    )
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      for (const storeName of [STATE_STORE_NAME, SESSION_STORE_NAME, META_STORE_NAME, DPOP_NONCE_STORE_NAME]) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName)
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      reject(
        new OAuthStorageError(
          'Failed to open IndexedDB for OAuth storage. Check browser storage permissions and try again.',
          request.error,
        ),
      )
    }
  })

  return dbPromise
}

async function readStoredValue<T>(storeName: string, key: string): Promise<StoredValue<T> | undefined> {
  const db = await getDatabase()
  return transaction<T | undefined>(db, storeName, 'readonly', (store) => store.get(key)) as Promise<StoredValue<T> | undefined>
}

async function writeStoredValue<T>(storeName: string, key: string, value: T): Promise<void> {
  const db = await getDatabase()
  await transaction(db, storeName, 'readwrite', (store) => store.put({ createdAt: Date.now(), value }, key))
}

async function deleteValue(storeName: string, key: string): Promise<void> {
  const db = await getDatabase()
  await transaction(db, storeName, 'readwrite', (store) => store.delete(key))
}

function transaction<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const request = action(tx.objectStore(storeName))

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new OAuthStorageError(`IndexedDB ${storeName} operation failed.`, request.error))
    tx.onerror = () => reject(new OAuthStorageError(`IndexedDB ${storeName} transaction failed.`, tx.error))
  })
}

function normalizePrivateJwk(jwk: JsonWebKey, kid: string): PrivateJwk {
  const candidate = {
    ...jwk,
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
    d: jwk.d,
    alg: 'ES256',
    kid: (jwk as { kid?: string }).kid ?? kid,
    use: 'sig',
    key_ops: ['sign'],
  }

  assertP256PrivateJwk(candidate)
  return candidate
}

function assertP256PrivateJwk(jwk: unknown): asserts jwk is PrivateJwk {
  const candidate = jwk as Partial<PrivateJwk>
  if (candidate.kty !== 'EC' || candidate.crv !== 'P-256' || candidate.alg !== 'ES256') {
    throw new OAuthStorageError('Stored OAuth DPoP key is not an ES256 P-256 key. Clear site data and sign in again.')
  }
  if (!candidate.x || !candidate.y || !candidate.d) {
    throw new OAuthStorageError('Stored OAuth DPoP key is missing private key material. Clear site data and sign in again.')
  }
}

function assertWebCrypto(): void {
  if (!globalThis.crypto?.subtle) {
    throw new OAuthStorageError('WebCrypto is unavailable, so OAuth DPoP signing cannot run in this browser.')
  }
}

function randomKeyId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return base64UrlBytes(bytes)
}

function base64UrlJson(value: unknown): string {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)))
}

function parseBase64UrlJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as T
}

function base64UrlBytes(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
