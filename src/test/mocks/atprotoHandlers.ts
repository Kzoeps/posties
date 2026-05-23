import type { OAuthSession } from '@atproto/oauth-client'

import { QUOTE_COLLECTION_NSID, SETTINGS_COLLECTION_NSID, SETTINGS_RECORD_KEY } from '../../lib/atproto/nsids'
import type {
  AtprotoCid,
  AtprotoRecordValue,
  AtprotoRepoRecord,
  CreateRepoRecordInput,
  DeleteRepoRecordInput,
  DeleteRepoRecordOutput,
  GetRepoRecordInput,
  ListRepoRecordsInput,
  ListRepoRecordsOutput,
  PutRepoRecordInput,
  PutSettingsRecordInput,
  WriteRepoRecordOutput,
} from '../../lib/atproto/records'
import type { QuoteColor, QuoteRecordValue } from '../../features/quotes/quoteTypes'
import type { ResolvedAtprotoIdentity } from '../../lib/atproto/identity'

/** DID used by the browser e2e OAuth mock unless a test seeds a different account. */
export const MOCK_ATPROTO_DID = 'did:plc:stickyquotee2euser'

/** Handle used by default when tests need the mocked active DID to have a route URL. */
export const MOCK_ATPROTO_HANDLE = 'alice.test'

/** PDS endpoint used by deterministic mock identities. */
export const MOCK_ATPROTO_PDS_ENDPOINT = 'https://mock.pds.local'

/** localStorage flag that enables the app-level ATProto mock boundary in tests. */
export const ATPROTO_MOCK_ENABLED_STORAGE_KEY = 'atproto-sticky-canvas:mock-enabled'

/** localStorage key containing the deterministic mock PDS/OAuth state shared across reloads. */
export const ATPROTO_MOCK_STATE_STORAGE_KEY = 'atproto-sticky-canvas:mock-state'

/** Operation names that can be failed once with `setMockAtprotoFailure`. */
export type MockAtprotoFailureOperation =
  | 'listRecords'
  | 'getRecord'
  | 'createRecord'
  | 'putRecord'
  | 'deleteRecord'
  | 'getSettings'
  | 'putSettings'

/** Failure kinds supported by the deterministic ATProto boundary mock. */
export type MockAtprotoFailureKind = 'network' | 'server' | 'conflict' | 'not-found' | 'validation'

/** One public record stored in the deterministic mock PDS. */
export type MockStoredAtprotoRecord = {
  /** AT URI for this mock record. */
  uri: string
  /** Latest CID for compare-and-swap behavior. */
  cid: AtprotoCid
  /** Stored record value, validated by the same app code as real PDS records. */
  value: AtprotoRecordValue
}

/** Per-repo state used by the deterministic mock PDS. */
export type MockAtprotoRepoState = {
  /** Account DID that owns this repo. */
  did: string
  /** Next generated quote rkey suffix. */
  nextRkey: number
  /** Next generated mock CID suffix. */
  nextCid: number
  /** Quote records keyed by rkey. */
  quotes: Record<string, MockStoredAtprotoRecord>
  /** Optional singleton settings record at rkey `self`. */
  settings?: MockStoredAtprotoRecord
  /** One-shot failures consumed by matching mock operations. */
  failures: Partial<Record<MockAtprotoFailureOperation, MockAtprotoFailureKind>>
}

/** Root state persisted in browser storage so e2e tests survive reloads. */
export type MockAtprotoState = {
  /** DID selected by the mocked OAuth flow. */
  activeDid: string | null
  /** Handle-to-DID map used by public `/:handle` identity resolution. */
  handles: Record<string, string>
  /** DID-to-current-handle/PDS map used for canonicalization and public reads. */
  didIdentities: Record<string, ResolvedAtprotoIdentity>
  /** Mock repos keyed by DID. */
  repos: Record<string, MockAtprotoRepoState>
}

/** Seed accepted by `seedMockQuoteRecords` for concise integration/e2e fixtures. */
export type MockQuoteRecordSeed = Partial<Omit<QuoteRecordValue, '$type' | 'schemaVersion' | 'createdAt' | 'updatedAt'>> & {
  /** Optional stable rkey; generated when omitted. */
  rkey?: string
  /** Optional CID; generated when omitted. */
  cid?: AtprotoCid
  /** Quote text to store in the mock PDS. */
  text: string
  /** ISO creation time; deterministic default is used when omitted. */
  createdAt?: string
  /** ISO update time; deterministic default is used when omitted. */
  updatedAt?: string
}

const DEFAULT_CREATED_AT = '2026-01-01T00:00:00.000Z'
const DEFAULT_UPDATED_AT = '2026-01-01T00:00:00.000Z'
const DEFAULT_POSITION = { x: 0, y: 0 }
const DEFAULT_COLOR: QuoteColor = 'yellow'

/**
 * Returns whether app code should use the deterministic ATProto mock boundary.
 * Use `VITE_E2E_ATPROTO_MOCK=true`, `enableAtprotoMockRuntime()`, or the global flag in browser tests.
 */
export function isAtprotoMockRuntimeEnabled(): boolean {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | boolean | undefined> }).env
  if (viteEnv?.VITE_E2E_ATPROTO_MOCK === 'true' || viteEnv?.VITE_E2E_ATPROTO_MOCK === true) return true
  if ((globalThis as { __ATPROTO_STICKY_CANVAS_E2E_MOCK__?: boolean }).__ATPROTO_STICKY_CANVAS_E2E_MOCK__ === true) return true

  return readStorageFlag(ATPROTO_MOCK_ENABLED_STORAGE_KEY)
}

/** Enables the mock boundary for the current browser/jsdom runtime. Use this before calling app APIs in tests. */
export function enableAtprotoMockRuntime(): void {
  ;(globalThis as { __ATPROTO_STICKY_CANVAS_E2E_MOCK__?: boolean }).__ATPROTO_STICKY_CANVAS_E2E_MOCK__ = true
  writeStorageFlag(ATPROTO_MOCK_ENABLED_STORAGE_KEY, true)
}

/** Disables the mock boundary for the current browser/jsdom runtime without clearing saved mock records. */
export function disableAtprotoMockRuntime(): void {
  ;(globalThis as { __ATPROTO_STICKY_CANVAS_E2E_MOCK__?: boolean }).__ATPROTO_STICKY_CANVAS_E2E_MOCK__ = false
  writeStorageFlag(ATPROTO_MOCK_ENABLED_STORAGE_KEY, false)
}

/** Clears mock OAuth/PDS state and seeds an active DID for deterministic test setup. */
export function resetMockAtprotoState(options: { activeDid?: string | null } = {}): MockAtprotoState {
  enableAtprotoMockRuntime()
  const activeDid = options.activeDid === undefined ? MOCK_ATPROTO_DID : options.activeDid
  const state: MockAtprotoState = {
    activeDid,
    handles: {},
    didIdentities: {},
    repos: {},
  }
  if (activeDid) {
    state.repos[activeDid] = createEmptyRepo(activeDid)
    seedHandleInState(state, MOCK_ATPROTO_HANDLE, activeDid)
  }
  writeState(state)
  return state
}

/** Returns a deep-cloned snapshot of the persisted mock state for assertions and Playwright page helpers. */
export function getMockAtprotoStateSnapshot(): MockAtprotoState {
  return readState()
}

/** Seeds quote records in the mock PDS and returns the stored AT records. */
export function seedMockQuoteRecords(did: string, seeds: readonly MockQuoteRecordSeed[]): MockStoredAtprotoRecord[] {
  const state = readState()
  const repo = ensureRepo(state, did)
  const stored = seeds.map((seed) => {
    const rkey = seed.rkey ?? nextRkey(repo)
    const record: QuoteRecordValue = {
      $type: QUOTE_COLLECTION_NSID,
      schemaVersion: 1,
      text: seed.text,
      author: seed.author,
      sourceTitle: seed.sourceTitle,
      sourceUri: seed.sourceUri,
      position: seed.position ?? DEFAULT_POSITION,
      size: seed.size,
      rotationDegX100: seed.rotationDegX100 ?? 125,
      color: seed.color ?? DEFAULT_COLOR,
      zIndex: seed.zIndex,
      createdAt: seed.createdAt ?? DEFAULT_CREATED_AT,
      updatedAt: seed.updatedAt ?? DEFAULT_UPDATED_AT,
    }
    const entry: MockStoredAtprotoRecord = {
      uri: atUri(did, QUOTE_COLLECTION_NSID, rkey),
      cid: seed.cid ?? nextCid(repo),
      value: removeUndefinedFields(record),
    }
    repo.quotes[rkey] = entry
    return clone(entry)
  })
  writeState(state)
  return stored
}

/** Selects a mock OAuth account and ensures its repo exists. Use this to bypass real OAuth in tests. */
export function seedMockOAuthSession(did = MOCK_ATPROTO_DID, handle = MOCK_ATPROTO_HANDLE): void {
  const state = readState()
  state.activeDid = did
  ensureRepo(state, did)
  seedHandleInState(state, handle, did)
  writeState(state)
  enableAtprotoMockRuntime()
}

/** Seeds a deterministic handle-to-DID identity mapping for public page tests. */
export function seedMockHandle(
  handle: string,
  did: string,
  options: { currentHandle?: string; pdsEndpoint?: string } = {},
): ResolvedAtprotoIdentity {
  const state = readState()
  const identity = seedHandleInState(state, handle, did, options)
  ensureRepo(state, did)
  writeState(state)
  enableAtprotoMockRuntime()
  return clone(identity)
}

/** Resolves a mock handle to DID/current-handle/PDS data without using the network. */
export async function mockResolveHandleToIdentity(handle: string): Promise<ResolvedAtprotoIdentity> {
  const state = readState()
  const normalizedHandle = normalizeMockHandle(handle)
  const did = state.handles[normalizedHandle]
  if (!did) throw new Error(`Mock handle ${normalizedHandle} is not seeded. Seed it with seedMockHandle(handle, did) before resolving public notes pages.`)
  const identity = ensureIdentity(state, did)
  writeState(state)
  return clone(identity)
}

/** Resolves a mock DID to its current canonical handle and PDS endpoint. */
export async function mockResolveDidToIdentity(did: string): Promise<ResolvedAtprotoIdentity> {
  const state = readState()
  const identity = ensureIdentity(state, did)
  writeState(state)
  return clone(identity)
}

/** Schedules a one-shot mock failure for the next matching PDS operation. */
export function setMockAtprotoFailure(operation: MockAtprotoFailureOperation, kind: MockAtprotoFailureKind = 'network'): void {
  const state = readState()
  const repo = ensureRepo(state, requireActiveDid(state))
  repo.failures[operation] = kind
  writeState(state)
}

/** Starts mocked OAuth by selecting a deterministic DID and navigating to the normal callback route. */
export async function mockStartOAuthLogin(options: { handle: string; appState?: string; signal?: AbortSignal }): Promise<never> {
  if (options.signal?.aborted) throw new DOMException('Mock OAuth login was aborted.', 'AbortError')
  seedMockOAuthSession(MOCK_ATPROTO_DID, options.handle)
  const callbackUrl = new URL('/oauth/callback', window.location.origin)
  callbackUrl.searchParams.set('mock_oauth', '1')
  callbackUrl.searchParams.set('handle', options.handle)
  if (options.appState) callbackUrl.searchParams.set('state', options.appState)
  window.location.assign(callbackUrl)

  return new Promise<never>(() => {
    // Navigation intentionally leaves this page, matching the real OAuth helper.
  })
}

/** Completes the mocked OAuth callback and returns a fake OAuth session summary. */
export async function mockCompleteOAuthCallback(): Promise<{ did: string; session: OAuthSession }> {
  const state = readState()
  const did = state.activeDid ?? MOCK_ATPROTO_DID
  state.activeDid = did
  ensureRepo(state, did)
  ensureIdentity(state, did)
  writeState(state)
  enableAtprotoMockRuntime()
  return { did, session: createMockOAuthSession(did) }
}

/** Restores the mocked active OAuth session, or null when no mock account is signed in. */
export async function mockRestoreActiveOAuthSession(): Promise<{ did: string; session: OAuthSession } | null> {
  const state = readState()
  if (!state.activeDid) return null
  ensureRepo(state, state.activeDid)
  writeState(state)
  return { did: state.activeDid, session: createMockOAuthSession(state.activeDid) }
}

/** Logs out of the mocked OAuth session while leaving mock PDS records available for later test assertions. */
export async function mockLogoutActiveOAuthSession(): Promise<void> {
  const state = readState()
  state.activeDid = null
  writeState(state)
}

/** Lists one deterministic page of mock repo records, including cursor behavior for pagination tests. */
export async function mockListRepoRecords<TRecord extends AtprotoRecordValue = AtprotoRecordValue>(
  input: ListRepoRecordsInput,
): Promise<ListRepoRecordsOutput<TRecord>> {
  const state = readState()
  const did = input.repo ?? requireActiveDid(state)
  const repo = ensureRepo(state, did)
  consumeFailure(state, repo, 'listRecords')
  const allRecords = recordsForCollection(repo, input.collection)
  const orderedRecords = input.reverse ? [...allRecords].reverse() : allRecords
  const offset = input.cursor ? Number(input.cursor) : 0
  const limit = input.limit ?? 100
  const page = orderedRecords.slice(offset, offset + limit)
  const cursor = offset + limit < orderedRecords.length ? String(offset + limit) : undefined
  writeState(state)

  return {
    cursor,
    records: page.map((record) => clone(record) as AtprotoRepoRecord<TRecord> & { cid: AtprotoCid }),
  }
}

/** Reads one mock repo record by collection/rkey and throws a RecordNotFound-shaped error when absent. */
export async function mockGetRepoRecord<TRecord extends AtprotoRecordValue = AtprotoRecordValue>(
  input: GetRepoRecordInput,
): Promise<AtprotoRepoRecord<TRecord>> {
  const state = readState()
  const did = input.repo ?? requireActiveDid(state)
  const repo = ensureRepo(state, did)
  consumeFailure(state, repo, input.collection === SETTINGS_COLLECTION_NSID ? 'getSettings' : 'getRecord')
  const record = getStoredRecord(repo, input.collection, input.rkey)
  if (!record) throwMockPdsError('not-found', 'get record')
  writeState(state)
  return clone(record) as AtprotoRepoRecord<TRecord>
}

/** Creates one mock repo record and returns PDS-shaped URI/CID write metadata. */
export async function mockCreateRepoRecord<TRecord extends AtprotoRecordValue = AtprotoRecordValue>(
  input: CreateRepoRecordInput<TRecord>,
): Promise<WriteRepoRecordOutput> {
  const state = readState()
  const did = input.repo ?? requireActiveDid(state)
  const repo = ensureRepo(state, did)
  consumeFailure(state, repo, 'createRecord')
  const rkey = input.rkey ?? nextRkey(repo)
  const record: MockStoredAtprotoRecord = {
    uri: atUri(did, input.collection, rkey),
    cid: nextCid(repo),
    value: clone(input.record),
  }
  setStoredRecord(repo, input.collection, rkey, record)
  writeState(state)
  return writeOutput(record)
}

/** Replaces one mock repo record and enforces `swapRecord` stale-CID conflicts. */
export async function mockPutRepoRecord<TRecord extends AtprotoRecordValue = AtprotoRecordValue>(
  input: PutRepoRecordInput<TRecord>,
): Promise<WriteRepoRecordOutput> {
  const state = readState()
  const did = input.repo ?? requireActiveDid(state)
  const repo = ensureRepo(state, did)
  consumeFailure(state, repo, input.collection === SETTINGS_COLLECTION_NSID ? 'putSettings' : 'putRecord')
  const current = getStoredRecord(repo, input.collection, input.rkey)
  assertSwapRecord(input.swapRecord, current, 'put record')
  const record: MockStoredAtprotoRecord = {
    uri: atUri(did, input.collection, input.rkey),
    cid: nextCid(repo),
    value: clone(input.record),
  }
  setStoredRecord(repo, input.collection, input.rkey, record)
  writeState(state)
  return writeOutput(record)
}

/** Deletes one mock repo record and enforces `swapRecord` stale-CID conflicts. */
export async function mockDeleteRepoRecord(input: DeleteRepoRecordInput): Promise<DeleteRepoRecordOutput> {
  const state = readState()
  const did = input.repo ?? requireActiveDid(state)
  const repo = ensureRepo(state, did)
  consumeFailure(state, repo, 'deleteRecord')
  const current = getStoredRecord(repo, input.collection, input.rkey)
  if (!current) throwMockPdsError('not-found', 'delete record')
  assertSwapRecord(input.swapRecord, current, 'delete record')
  deleteStoredRecord(repo, input.collection, input.rkey)
  writeState(state)
  return { commit: { cid: nextCid(repo), rev: `mock-rev-${repo.nextCid}` } }
}

/** Reads the singleton mock canvas settings record from rkey `self`. */
export function mockGetSettingsRecord<TRecord extends AtprotoRecordValue = AtprotoRecordValue>(
  input: { repo?: string; cid?: AtprotoCid; signal?: AbortSignal } = {},
): Promise<AtprotoRepoRecord<TRecord>> {
  return mockGetRepoRecord<TRecord>({ repo: input.repo, collection: SETTINGS_COLLECTION_NSID, rkey: SETTINGS_RECORD_KEY, cid: input.cid, signal: input.signal })
}

/** Replaces the singleton mock canvas settings record at rkey `self`. */
export function mockPutSettingsRecord<TRecord extends AtprotoRecordValue = AtprotoRecordValue>(
  input: PutSettingsRecordInput<TRecord>,
): Promise<WriteRepoRecordOutput> {
  return mockPutRepoRecord<TRecord>({
    repo: input.repo,
    collection: SETTINGS_COLLECTION_NSID,
    rkey: SETTINGS_RECORD_KEY,
    record: input.record,
    validate: input.validate,
    swapRecord: input.swapRecord,
    swapCommit: input.swapCommit,
    signal: input.signal,
  })
}

/**
 * Creates a fetch handler for code paths that still issue XRPC-shaped HTTP requests in tests.
 * Prefer the typed mock repo helpers above when testing app code directly.
 */
export function createMockAtprotoFetchHandler(did = MOCK_ATPROTO_DID): OAuthSession['fetchHandler'] {
  return async (url, init = {}) => {
    const requestUrl = new URL(url, window.location.origin)
    const method = init.method?.toUpperCase() ?? 'GET'
    const body = init.body ? JSON.parse(String(init.body)) : undefined

    if (requestUrl.pathname.endsWith('/xrpc/com.atproto.repo.listRecords')) {
      const output = await mockListRepoRecords({
        repo: requestUrl.searchParams.get('repo') ?? did,
        collection: requiredSearchParam(requestUrl, 'collection'),
        limit: numberSearchParam(requestUrl, 'limit'),
        cursor: requestUrl.searchParams.get('cursor') ?? undefined,
      })
      return jsonResponse(output)
    }

    if (requestUrl.pathname.endsWith('/xrpc/com.atproto.repo.getRecord')) {
      const output = await mockGetRepoRecord({
        repo: requestUrl.searchParams.get('repo') ?? did,
        collection: requiredSearchParam(requestUrl, 'collection'),
        rkey: requiredSearchParam(requestUrl, 'rkey'),
      })
      return jsonResponse(output)
    }

    if (method === 'POST' && requestUrl.pathname.endsWith('/xrpc/com.atproto.repo.createRecord')) {
      return jsonResponse(await mockCreateRepoRecord(body))
    }

    if (method === 'POST' && requestUrl.pathname.endsWith('/xrpc/com.atproto.repo.putRecord')) {
      return jsonResponse(await mockPutRepoRecord(body))
    }

    if (method === 'POST' && requestUrl.pathname.endsWith('/xrpc/com.atproto.repo.deleteRecord')) {
      return jsonResponse(await mockDeleteRepoRecord(body))
    }

    return new Response(JSON.stringify({ error: 'MockRouteNotFound', message: `No mock XRPC route for ${requestUrl.pathname}` }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }
}

function createMockOAuthSession(did: string): OAuthSession {
  return {
    did,
    fetchHandler: createMockAtprotoFetchHandler(did),
  } as OAuthSession
}

function readState(): MockAtprotoState {
  const storage = getStorage()
  const raw = storage?.getItem(ATPROTO_MOCK_STATE_STORAGE_KEY)
  if (!raw) return { activeDid: null, handles: {}, didIdentities: {}, repos: {} }

  try {
    return normalizeState(JSON.parse(raw) as Partial<MockAtprotoState>)
  } catch {
    return { activeDid: null, handles: {}, didIdentities: {}, repos: {} }
  }
}

function writeState(state: MockAtprotoState): void {
  getStorage()?.setItem(ATPROTO_MOCK_STATE_STORAGE_KEY, JSON.stringify(state))
}

function getStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function readStorageFlag(key: string): boolean {
  return getStorage()?.getItem(key) === 'true'
}

function writeStorageFlag(key: string, enabled: boolean): void {
  const storage = getStorage()
  if (!storage) return
  if (enabled) storage.setItem(key, 'true')
  else storage.removeItem(key)
}

function createEmptyRepo(did: string): MockAtprotoRepoState {
  return { did, nextRkey: 1, nextCid: 1, quotes: {}, failures: {} }
}

function ensureRepo(state: MockAtprotoState, did: string): MockAtprotoRepoState {
  state.repos[did] ??= createEmptyRepo(did)
  return state.repos[did]
}

function normalizeState(state: Partial<MockAtprotoState>): MockAtprotoState {
  return {
    activeDid: state.activeDid ?? null,
    handles: state.handles ?? {},
    didIdentities: state.didIdentities ?? {},
    repos: state.repos ?? {},
  }
}

function seedHandleInState(
  state: MockAtprotoState,
  handle: string,
  did: string,
  options: { currentHandle?: string; pdsEndpoint?: string } = {},
): ResolvedAtprotoIdentity {
  const normalizedHandle = normalizeMockHandle(handle)
  const currentHandle = normalizeMockHandle(options.currentHandle ?? normalizedHandle)
  const identity: ResolvedAtprotoIdentity = {
    did,
    handle: currentHandle,
    pdsEndpoint: options.pdsEndpoint ?? MOCK_ATPROTO_PDS_ENDPOINT,
  }
  state.handles[normalizedHandle] = did
  state.handles[currentHandle] = did
  state.didIdentities[did] = identity
  return identity
}

function ensureIdentity(state: MockAtprotoState, did: string): ResolvedAtprotoIdentity {
  const existing = state.didIdentities[did]
  if (existing) return existing
  return seedHandleInState(state, mockFallbackHandle(did), did)
}

function normalizeMockHandle(handle: string): string {
  return handle.trim().replace(/^@/, '').replace(/\.$/, '').toLowerCase()
}

function mockFallbackHandle(did: string): string {
  if (did === MOCK_ATPROTO_DID) return MOCK_ATPROTO_HANDLE
  const suffix = did.replace(/^did:[^:]+:/, '').replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
  return `${suffix || 'user'}.test`
}

function requireActiveDid(state: MockAtprotoState): string {
  if (state.activeDid) return state.activeDid
  throw new Error('Mock ATProto session is not signed in. Seed a mock OAuth session before calling repo helpers.')
}

function recordsForCollection(repo: MockAtprotoRepoState, collection: string): MockStoredAtprotoRecord[] {
  if (collection === QUOTE_COLLECTION_NSID) return Object.values(repo.quotes).sort((left, right) => left.uri.localeCompare(right.uri))
  if (collection === SETTINGS_COLLECTION_NSID) return repo.settings ? [repo.settings] : []
  return []
}

function getStoredRecord(repo: MockAtprotoRepoState, collection: string, rkey: string): MockStoredAtprotoRecord | undefined {
  if (collection === QUOTE_COLLECTION_NSID) return repo.quotes[rkey]
  if (collection === SETTINGS_COLLECTION_NSID && rkey === SETTINGS_RECORD_KEY) return repo.settings
  return undefined
}

function setStoredRecord(repo: MockAtprotoRepoState, collection: string, rkey: string, record: MockStoredAtprotoRecord): void {
  if (collection === QUOTE_COLLECTION_NSID) {
    repo.quotes[rkey] = record
    return
  }

  if (collection === SETTINGS_COLLECTION_NSID && rkey === SETTINGS_RECORD_KEY) {
    repo.settings = record
    return
  }

  throw new Error(`Mock collection ${collection} is not supported. Add a mock collection branch before testing this PDS record.`)
}

function deleteStoredRecord(repo: MockAtprotoRepoState, collection: string, rkey: string): void {
  if (collection === QUOTE_COLLECTION_NSID) {
    delete repo.quotes[rkey]
    return
  }

  if (collection === SETTINGS_COLLECTION_NSID && rkey === SETTINGS_RECORD_KEY) {
    repo.settings = undefined
  }
}

function assertSwapRecord(swapRecord: string | null | undefined, current: MockStoredAtprotoRecord | undefined, action: string): void {
  if (swapRecord === undefined || swapRecord === null) return
  if (!current || current.cid !== swapRecord) throwMockPdsError('conflict', action)
}

function consumeFailure(state: MockAtprotoState, repo: MockAtprotoRepoState, operation: MockAtprotoFailureOperation): void {
  const failure = repo.failures[operation]
  if (!failure) return

  delete repo.failures[operation]
  writeState(state)
  throwMockPdsError(failure, operation)
}

function throwMockPdsError(kind: MockAtprotoFailureKind, action: string): never {
  const details = errorDetails(kind, action)
  const error = new Error(details.message) as Error & { status?: number; error?: string }
  error.status = details.status
  error.error = details.error
  throw error
}

function errorDetails(kind: MockAtprotoFailureKind, action: string): { status?: number; error?: string; message: string } {
  switch (kind) {
    case 'network':
      return { message: `Mock network failure during ${action}. Retry when the PDS is reachable.` }
    case 'server':
      return { status: 503, error: 'ServiceUnavailable', message: `Mock PDS server failure during ${action}.` }
    case 'conflict':
      return { status: 400, error: 'InvalidSwap', message: `Mock stale CID conflict during ${action}.` }
    case 'not-found':
      return { status: 404, error: 'RecordNotFound', message: `Mock record was not found during ${action}.` }
    case 'validation':
      return { status: 400, error: 'InvalidRequest', message: `Mock validation failure during ${action}.` }
  }
}

function nextRkey(repo: MockAtprotoRepoState): string {
  const value = `mock-${repo.nextRkey}`
  repo.nextRkey += 1
  return value
}

function nextCid(repo: MockAtprotoRepoState): AtprotoCid {
  const value = `mock-cid-${repo.nextCid}`
  repo.nextCid += 1
  return value
}

function atUri(did: string, collection: string, rkey: string): string {
  return `at://${did}/${collection}/${rkey}`
}

function writeOutput(record: MockStoredAtprotoRecord): WriteRepoRecordOutput {
  return {
    uri: record.uri,
    cid: record.cid,
    commit: { cid: record.cid, rev: `mock-rev-${record.cid}` },
    validationStatus: 'valid',
  }
}

function removeUndefinedFields<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function requiredSearchParam(url: URL, key: string): string {
  const value = url.searchParams.get(key)
  if (!value) throw new Error(`Mock XRPC request is missing required search param ${key}.`)
  return value
}

function numberSearchParam(url: URL, key: string): number | undefined {
  const value = url.searchParams.get(key)
  return value ? Number(value) : undefined
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
