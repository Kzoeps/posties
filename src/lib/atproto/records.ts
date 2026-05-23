import type {
  ComAtprotoRepoCreateRecord,
  ComAtprotoRepoDeleteRecord,
  ComAtprotoRepoDefs,
  ComAtprotoRepoPutRecord,
} from '@atproto/api'
import { Agent, XRPCError } from '@atproto/api'

import { getAuthenticatedAtprotoAgent, getXrpcErrorDetails } from './agent'
import { SETTINGS_COLLECTION_NSID, SETTINGS_RECORD_KEY } from './nsids'

const DEFAULT_LIST_RECORDS_LIMIT = 100

/** DID, handle, or repo identifier accepted by ATProto repo XRPC methods. */
export type AtprotoRepoIdentifier = string

/** NSID of an ATProto record collection, for example `com.kzoeps.stickyquotes.canvas.quote`. */
export type AtprotoCollectionNsid = string

/** Record key within an ATProto collection. */
export type AtprotoRecordKey = string

/** CID string returned by a PDS for records or commits. */
export type AtprotoCid = string

/** AT URI string returned by repo record writes and reads. */
export type AtprotoUri = string

/** JSON-like ATProto record object that contains lexicon-specific fields. */
export type AtprotoRecordValue = Record<string, unknown>

/** Normalized record returned by generic repo read helpers. */
export type AtprotoRepoRecord<TRecord extends AtprotoRecordValue = AtprotoRecordValue> = {
  /** AT URI that identifies this record version location. */
  uri: AtprotoUri
  /** Current record CID when the PDS returned one. Keep this for compare-and-swap writes. */
  cid?: AtprotoCid
  /** Raw record value. Feature modules should validate it against their lexicon before use. */
  value: TRecord
}

/** Metadata returned by write operations when the PDS includes commit details. */
export type AtprotoCommitMeta = ComAtprotoRepoDefs.CommitMeta

/** Read mode for repo record helpers. Public reads use a resolved PDS endpoint and do not require OAuth. */
export type AtprotoRepoReadAuth = 'authenticated' | 'public'

/** Options shared by authenticated repo record calls. */
export type AtprotoRepoCallOptions = {
  /** Optional abort signal for cancelling route transitions, retries, or component unmounts. */
  signal?: AbortSignal
}

/** Options shared by repo record read calls that may be public or authenticated. */
export type AtprotoRepoReadCallOptions = AtprotoRepoCallOptions & {
  /** Use `public` with `repo` and `serviceEndpoint` to read a DID repo without an OAuth session. */
  auth?: AtprotoRepoReadAuth
  /** PDS service endpoint resolved from the owner DID document for unauthenticated public reads. */
  serviceEndpoint?: string
}

/** Input for listing one page of records from an authenticated user's PDS. */
export type ListRepoRecordsInput = AtprotoRepoReadCallOptions & {
  /** Repo to read; defaults to the signed-in user's DID for authenticated reads and is required for public reads. */
  repo?: AtprotoRepoIdentifier
  /** Collection NSID to list. */
  collection: AtprotoCollectionNsid
  /** Page size requested from the PDS. Defaults to 100. */
  limit?: number
  /** Cursor returned by a previous list call. */
  cursor?: string
  /** Whether the PDS should return records in reverse order. */
  reverse?: boolean
}

/** One page of records from `com.atproto.repo.listRecords`. */
export type ListRepoRecordsOutput<TRecord extends AtprotoRecordValue = AtprotoRecordValue> = {
  /** Cursor to pass to the next page request, or undefined when pagination is complete. */
  cursor?: string
  /** Records returned by the PDS, with values left for feature-specific validation. */
  records: Array<AtprotoRepoRecord<TRecord> & { cid: AtprotoCid }>
}

/** Input for reading one record from an authenticated user's PDS. */
export type GetRepoRecordInput = AtprotoRepoReadCallOptions & {
  /** Repo to read; defaults to the signed-in user's DID for authenticated reads and is required for public reads. */
  repo?: AtprotoRepoIdentifier
  /** Collection NSID containing the record. */
  collection: AtprotoCollectionNsid
  /** Record key to read. */
  rkey: AtprotoRecordKey
  /** Optional CID for reading a specific record version instead of the latest. */
  cid?: AtprotoCid
}

/** Input for creating one record in an authenticated user's PDS. */
export type CreateRepoRecordInput<TRecord extends AtprotoRecordValue = AtprotoRecordValue> = AtprotoRepoCallOptions & {
  /** Repo to write; defaults to the signed-in user's DID. */
  repo?: AtprotoRepoIdentifier
  /** Collection NSID to create the record in. */
  collection: AtprotoCollectionNsid
  /** Optional record key; omit for collections that use PDS-generated keys. */
  rkey?: AtprotoRecordKey
  /** Whether the PDS should enforce lexicon validation for this record. */
  validate?: boolean
  /** Record body. It must contain the lexicon `$type` expected by the collection. */
  record: TRecord
  /** Optional compare-and-swap commit CID when callers need commit-level protection. */
  swapCommit?: AtprotoCid
}

/** Result returned after creating or replacing a record. */
export type WriteRepoRecordOutput = {
  /** AT URI of the written record. */
  uri: AtprotoUri
  /** CID of the written record; use this as `swapRecord` for later updates/deletes. */
  cid: AtprotoCid
  /** Commit metadata returned by the PDS, when available. */
  commit?: AtprotoCommitMeta
  /** PDS validation result for custom lexicons, commonly `valid` or `unknown`. */
  validationStatus?: string
}

/** Input for replacing one record in an authenticated user's PDS. */
export type PutRepoRecordInput<TRecord extends AtprotoRecordValue = AtprotoRecordValue> = AtprotoRepoCallOptions & {
  /** Repo to write; defaults to the signed-in user's DID. */
  repo?: AtprotoRepoIdentifier
  /** Collection NSID containing the record. */
  collection: AtprotoCollectionNsid
  /** Record key to replace. */
  rkey: AtprotoRecordKey
  /** Whether the PDS should enforce lexicon validation for this record. */
  validate?: boolean
  /** Full replacement record body. */
  record: TRecord
  /** Previous record CID for compare-and-swap protection; stale values cause an InvalidSwap error. */
  swapRecord?: AtprotoCid | null
  /** Optional compare-and-swap commit CID when callers need commit-level protection. */
  swapCommit?: AtprotoCid
}

/** Input for deleting one record from an authenticated user's PDS. */
export type DeleteRepoRecordInput = AtprotoRepoCallOptions & {
  /** Repo to write; defaults to the signed-in user's DID. */
  repo?: AtprotoRepoIdentifier
  /** Collection NSID containing the record. */
  collection: AtprotoCollectionNsid
  /** Record key to delete. */
  rkey: AtprotoRecordKey
  /** Previous record CID for compare-and-swap protection; stale values cause an InvalidSwap error. */
  swapRecord?: AtprotoCid
  /** Optional compare-and-swap commit CID when callers need commit-level protection. */
  swapCommit?: AtprotoCid
}

/** Result returned after deleting a record. */
export type DeleteRepoRecordOutput = {
  /** Commit metadata returned by the PDS, when available. */
  commit?: AtprotoCommitMeta
}

/** Input for reading the app's singleton settings record from a user's repo. */
export type GetSettingsRecordInput = AtprotoRepoReadCallOptions & {
  /** Repo to read; defaults to the signed-in user's DID for authenticated reads and is required for public reads. */
  repo?: AtprotoRepoIdentifier
  /** Optional CID for reading a specific settings version instead of the latest. */
  cid?: AtprotoCid
}

/** Input for replacing the app's singleton settings record in a user's repo. */
export type PutSettingsRecordInput<TRecord extends AtprotoRecordValue = AtprotoRecordValue> = AtprotoRepoCallOptions & {
  /** Repo to write; defaults to the signed-in user's DID. */
  repo?: AtprotoRepoIdentifier
  /** Full settings record body. Feature modules should validate it before calling this helper. */
  record: TRecord
  /** Whether the PDS should enforce lexicon validation for this settings record. */
  validate?: boolean
  /** Previous settings record CID for compare-and-swap protection. */
  swapRecord?: AtprotoCid | null
  /** Optional compare-and-swap commit CID when callers need commit-level protection. */
  swapCommit?: AtprotoCid
}

/** Machine-readable category for PDS record wrapper failures. */
export type AtprotoRecordErrorKind = 'auth' | 'conflict' | 'not-found' | 'network' | 'server' | 'validation' | 'unknown'

/**
 * Error thrown by generic PDS record helpers with enough metadata for UI retries and conflict flows.
 * Check `kind === 'conflict'` or call `isAtprotoRecordConflictError` for stale-CID handling.
 */
export class AtprotoRecordError extends Error {
  /** Machine-readable category that callers can use for retry/conflict behavior. */
  readonly kind: AtprotoRecordErrorKind
  /** Original SDK or browser error. */
  readonly cause?: unknown
  /** XRPC status code when present. */
  readonly status?: number
  /** XRPC error name when present, for example `InvalidSwap` or `RecordNotFound`. */
  readonly xrpcError?: string
  /** Context about the failed repo operation, safe for logs and developer messages. */
  readonly context: Record<string, string | number | boolean | undefined>

  constructor(
    message: string,
    options: {
      kind: AtprotoRecordErrorKind
      cause?: unknown
      context?: Record<string, string | number | boolean | undefined>
    },
  ) {
    super(message)
    this.name = 'AtprotoRecordError'
    this.kind = options.kind
    this.cause = options.cause
    this.context = options.context ?? {}

    const details = getXrpcErrorDetails(options.cause)
    this.status = details.status
    this.xrpcError = details.error
  }
}

/**
 * Lists one page of records from a collection in the active user's repo or a provided repo.
 * Use the returned cursor with the same input to continue pagination.
 */
export async function listRepoRecords<TRecord extends AtprotoRecordValue = AtprotoRecordValue>(
  input: ListRepoRecordsInput,
): Promise<ListRepoRecordsOutput<TRecord>> {
  const mock = await getMockRecordBoundary()
  if (mock) return mock.mockListRepoRecords<TRecord>(input)

  const { agent, did } = await getReadRecordAgent(input, 'list records')
  const repo = input.repo ?? did

  try {
    const response = await agent.com.atproto.repo.listRecords(
      {
        repo,
        collection: input.collection,
        limit: input.limit ?? DEFAULT_LIST_RECORDS_LIMIT,
        cursor: input.cursor,
        reverse: input.reverse,
      },
      { signal: input.signal },
    )

    return {
      cursor: response.data.cursor,
      records: response.data.records.map((record) => ({
        uri: record.uri,
        cid: record.cid,
        value: record.value as TRecord,
      })),
    }
  } catch (error) {
    throw toAtprotoRecordError('list records', error, {
      repo,
      collection: input.collection,
      cursor: input.cursor,
    })
  }
}

/**
 * Lists every page from a collection and returns all records in one array.
 * Prefer `listRepoRecords` when UI code wants explicit page-by-page loading.
 */
export async function listAllRepoRecords<TRecord extends AtprotoRecordValue = AtprotoRecordValue>(
  input: Omit<ListRepoRecordsInput, 'cursor'>,
): Promise<Array<AtprotoRepoRecord<TRecord> & { cid: AtprotoCid }>> {
  const records: Array<AtprotoRepoRecord<TRecord> & { cid: AtprotoCid }> = []
  let cursor: string | undefined

  do {
    const page = await listRepoRecords<TRecord>({ ...input, cursor })
    records.push(...page.records)
    cursor = page.cursor
  } while (cursor)

  return records
}

/**
 * Reads one record from a collection in the active user's repo or a provided repo.
 * A missing record is returned as an actionable `AtprotoRecordError` with kind `not-found`.
 */
export async function getRepoRecord<TRecord extends AtprotoRecordValue = AtprotoRecordValue>(
  input: GetRepoRecordInput,
): Promise<AtprotoRepoRecord<TRecord>> {
  const mock = await getMockRecordBoundary()
  if (mock) return mock.mockGetRepoRecord<TRecord>(input)

  const { agent, did } = await getReadRecordAgent(input, 'get record')
  const repo = input.repo ?? did

  try {
    const response = await agent.com.atproto.repo.getRecord(
      {
        repo,
        collection: input.collection,
        rkey: input.rkey,
        cid: input.cid,
      },
      { signal: input.signal },
    )

    return {
      uri: response.data.uri,
      cid: response.data.cid,
      value: response.data.value as TRecord,
    }
  } catch (error) {
    throw toAtprotoRecordError('get record', error, {
      repo,
      collection: input.collection,
      rkey: input.rkey,
      cid: input.cid,
    })
  }
}

/**
 * Creates one record in a collection in the active user's repo or a provided repo.
 * For PDS-generated rkeys, omit `rkey` and keep the returned URI/CID in caller state.
 */
export async function createRepoRecord<TRecord extends AtprotoRecordValue = AtprotoRecordValue>(
  input: CreateRepoRecordInput<TRecord>,
): Promise<WriteRepoRecordOutput> {
  const mock = await getMockRecordBoundary()
  if (mock) return mock.mockCreateRepoRecord<TRecord>(input)

  const { agent, did } = await getRecordAgent('create record')
  const repo = input.repo ?? did

  try {
    const response = await agent.com.atproto.repo.createRecord(
      {
        repo,
        collection: input.collection,
        rkey: input.rkey,
        validate: input.validate,
        record: input.record,
        swapCommit: input.swapCommit,
      } satisfies ComAtprotoRepoCreateRecord.InputSchema,
      { signal: input.signal, encoding: 'application/json' },
    )

    return writeOutput(response.data)
  } catch (error) {
    throw toAtprotoRecordError('create record', error, {
      repo,
      collection: input.collection,
      rkey: input.rkey,
    })
  }
}

/**
 * Replaces one record using `com.atproto.repo.putRecord`.
 * Pass `swapRecord` with the last seen CID to prevent stale clients from overwriting remote edits.
 */
export async function putRepoRecord<TRecord extends AtprotoRecordValue = AtprotoRecordValue>(
  input: PutRepoRecordInput<TRecord>,
): Promise<WriteRepoRecordOutput> {
  const mock = await getMockRecordBoundary()
  if (mock) return mock.mockPutRepoRecord<TRecord>(input)

  const { agent, did } = await getRecordAgent('put record')
  const repo = input.repo ?? did

  try {
    const response = await agent.com.atproto.repo.putRecord(
      {
        repo,
        collection: input.collection,
        rkey: input.rkey,
        validate: input.validate,
        record: input.record,
        swapRecord: input.swapRecord,
        swapCommit: input.swapCommit,
      } satisfies ComAtprotoRepoPutRecord.InputSchema,
      { signal: input.signal, encoding: 'application/json' },
    )

    return writeOutput(response.data)
  } catch (error) {
    throw toAtprotoRecordError('put record', error, {
      repo,
      collection: input.collection,
      rkey: input.rkey,
      hasSwapRecord: input.swapRecord !== undefined,
    })
  }
}

/**
 * Deletes one record using `com.atproto.repo.deleteRecord`.
 * Pass `swapRecord` with the last seen CID to detect stale delete attempts.
 */
export async function deleteRepoRecord(input: DeleteRepoRecordInput): Promise<DeleteRepoRecordOutput> {
  const mock = await getMockRecordBoundary()
  if (mock) return mock.mockDeleteRepoRecord(input)

  const { agent, did } = await getRecordAgent('delete record')
  const repo = input.repo ?? did

  try {
    const response = await agent.com.atproto.repo.deleteRecord(
      {
        repo,
        collection: input.collection,
        rkey: input.rkey,
        swapRecord: input.swapRecord,
        swapCommit: input.swapCommit,
      } satisfies ComAtprotoRepoDeleteRecord.InputSchema,
      { signal: input.signal, encoding: 'application/json' },
    )

    return { commit: response.data.commit }
  } catch (error) {
    throw toAtprotoRecordError('delete record', error, {
      repo,
      collection: input.collection,
      rkey: input.rkey,
      hasSwapRecord: input.swapRecord !== undefined,
    })
  }
}

/**
 * Reads the app's singleton canvas settings record from `com.kzoeps.stickyquotes.canvas.settings/self`.
 * Missing settings are surfaced as `kind: 'not-found'` so callers can create defaults intentionally.
 */
export function getSettingsRecord<TRecord extends AtprotoRecordValue = AtprotoRecordValue>(
  input: GetSettingsRecordInput = {},
): Promise<AtprotoRepoRecord<TRecord>> {
  return getRepoRecord<TRecord>({
    repo: input.repo,
    collection: SETTINGS_COLLECTION_NSID,
    rkey: SETTINGS_RECORD_KEY,
    cid: input.cid,
    auth: input.auth,
    serviceEndpoint: input.serviceEndpoint,
    signal: input.signal,
  })
}

/**
 * Replaces the app's singleton canvas settings record at `com.kzoeps.stickyquotes.canvas.settings/self`.
 * Callers should validate the settings record before writing because this helper stays lexicon-agnostic.
 */
export function putSettingsRecord<TRecord extends AtprotoRecordValue = AtprotoRecordValue>(
  input: PutSettingsRecordInput<TRecord>,
): Promise<WriteRepoRecordOutput> {
  return putRepoRecord<TRecord>({
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
 * Returns true for stale-CID/compare-and-swap failures from put, delete, create, or wrapped errors.
 * Future mutation code should use this to branch into conflict refetch/merge flows instead of last-write-wins.
 */
export function isAtprotoRecordConflictError(error: unknown): boolean {
  if (error instanceof AtprotoRecordError && error.kind === 'conflict') return true
  if (error instanceof XRPCError && error.error === 'InvalidSwap') return true
  if (error instanceof XRPCError && Number(error.status) === 409) return true

  if (error && typeof error === 'object') {
    const maybeError = error as { name?: unknown; error?: unknown; status?: unknown; cause?: unknown }
    if (maybeError.name === 'InvalidSwapError' || maybeError.error === 'InvalidSwap' || maybeError.status === 409) {
      return true
    }
    if (maybeError.cause) return isAtprotoRecordConflictError(maybeError.cause)
  }

  return false
}

/**
 * Alias for `isAtprotoRecordConflictError` with stale-CID wording for mutation code readability.
 */
export function isStaleRecordCidError(error: unknown): boolean {
  return isAtprotoRecordConflictError(error)
}

async function getMockRecordBoundary(): Promise<typeof import('../../test/mocks/atprotoHandlers') | null> {
  if (!shouldLoadAtprotoMockBoundary()) return null
  const mock = await import('../../test/mocks/atprotoHandlers')
  return mock.isAtprotoMockRuntimeEnabled() ? mock : null
}

function shouldLoadAtprotoMockBoundary(): boolean {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | boolean | undefined> }).env
  if (viteEnv?.VITE_E2E_ATPROTO_MOCK === 'true' || viteEnv?.VITE_E2E_ATPROTO_MOCK === true) return true
  if ((globalThis as { __ATPROTO_STICKY_CANVAS_E2E_MOCK__?: boolean }).__ATPROTO_STICKY_CANVAS_E2E_MOCK__ === true) return true

  try {
    return globalThis.localStorage?.getItem('atproto-sticky-canvas:mock-enabled') === 'true'
  } catch {
    return false
  }
}

async function getRecordAgent(action: string) {
  try {
    return await getAuthenticatedAtprotoAgent()
  } catch (error) {
    throw new AtprotoRecordError(
      `Could not ${action} because there is no usable ATProto OAuth session. The user may be signed out or the stored token may be expired/revoked. Sign in again, then retry.`,
      {
        kind: 'auth',
        cause: error,
      },
    )
  }
}

async function getReadRecordAgent(input: AtprotoRepoReadCallOptions & { repo?: AtprotoRepoIdentifier }, action: string) {
  if (input.auth === 'public' || input.serviceEndpoint) {
    if (!input.repo) {
      throw new AtprotoRecordError(
        `Could not ${action} publicly because no repo DID was provided. Public reads do not have an OAuth session to infer a repo. Resolve the page handle to a DID first, then retry with repo set to that DID.`,
        {
          kind: 'validation',
          context: { auth: 'public', hasServiceEndpoint: Boolean(input.serviceEndpoint) },
        },
      )
    }

    if (!input.serviceEndpoint) {
      throw new AtprotoRecordError(
        `Could not ${action} publicly for repo ${input.repo}. What went wrong: no PDS service endpoint was provided. What to do: resolve the owner DID document and pass its #atproto_pds serviceEndpoint before reading public records.`,
        {
          kind: 'validation',
          context: { repo: input.repo, auth: 'public' },
        },
      )
    }

    return {
      did: input.repo,
      agent: new Agent({ service: normalizeHttpServiceEndpoint(input.serviceEndpoint, action) }),
    }
  }

  return getRecordAgent(action)
}

function normalizeHttpServiceEndpoint(rawEndpoint: string, action: string): string {
  let url: URL
  try {
    url = new URL(rawEndpoint)
  } catch (error) {
    throw new AtprotoRecordError(
      `Could not ${action} publicly. What went wrong: the PDS service endpoint "${rawEndpoint}" is not a valid URL. What to do: resolve the owner's DID document again and retry with a valid http(s) endpoint.`,
      { kind: 'validation', cause: error, context: { serviceEndpoint: rawEndpoint } },
    )
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AtprotoRecordError(
      `Could not ${action} publicly. What went wrong: the PDS service endpoint "${rawEndpoint}" does not use http(s). What to do: check the owner's DID document and retry with a valid PDS endpoint.`,
      { kind: 'validation', context: { serviceEndpoint: rawEndpoint } },
    )
  }

  url.pathname = url.pathname.replace(/\/$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function writeOutput(
  data: ComAtprotoRepoCreateRecord.OutputSchema | ComAtprotoRepoPutRecord.OutputSchema,
): WriteRepoRecordOutput {
  return {
    uri: data.uri,
    cid: data.cid,
    commit: data.commit,
    validationStatus: data.validationStatus,
  }
}

function toAtprotoRecordError(
  action: string,
  error: unknown,
  context: Record<string, string | number | boolean | undefined>,
): AtprotoRecordError {
  const details = getXrpcErrorDetails(error)
  const kind = classifyRecordError(error, details)
  const target = formatRecordContext(context)
  const why = explainRecordFailure(kind, details)
  const next = nextRecordStep(action, kind)

  return new AtprotoRecordError(`Could not ${action}${target}. ${why} ${next}`, {
    kind,
    cause: error,
    context,
  })
}

function classifyRecordError(
  error: unknown,
  details: { status?: number; error?: string },
): AtprotoRecordErrorKind {
  if (isAtprotoRecordConflictError(error)) return 'conflict'
  if (details.error === 'RecordNotFound' || details.status === 404) return 'not-found'
  if (details.status === 400 || details.status === 413) return 'validation'
  if (details.status === 401 || details.status === 403) return 'auth'
  if (details.status !== undefined && details.status >= 500) return 'server'

  if (error instanceof TypeError) return 'network'
  if (error instanceof DOMException && error.name === 'AbortError') return 'network'

  return 'unknown'
}

function explainRecordFailure(kind: AtprotoRecordErrorKind, details: { status?: number; error?: string; message?: string }): string {
  const suffix = details.error ? ` PDS error: ${details.error}.` : details.message ? ` Cause: ${details.message}.` : ''

  switch (kind) {
    case 'auth':
      return `The OAuth token was rejected or the session is no longer valid.${suffix}`
    case 'conflict':
      return `The stored CID is stale because the record changed on the PDS before this write.${suffix}`
    case 'not-found':
      return `The requested record does not exist in the repo or was already deleted.${suffix}`
    case 'network':
      return `The browser could not reach the PDS or the request was cancelled.${suffix}`
    case 'server':
      return `The PDS returned a server error.${suffix}`
    case 'validation':
      return `The PDS rejected the record shape, collection, rkey, or payload size.${suffix}`
    case 'unknown':
      return `The PDS request failed for an unexpected reason.${suffix}`
  }
}

function nextRecordStep(action: string, kind: AtprotoRecordErrorKind): string {
  switch (kind) {
    case 'auth':
      return 'Sign in again and retry the request.'
    case 'conflict':
      return 'Refetch the record, merge the local change if safe, and retry with the latest CID.'
    case 'not-found':
      return action === 'get record'
        ? 'Create the record if this is expected, or refresh local state if it should already exist.'
        : 'Refresh local state before retrying the write.'
    case 'network':
      return 'Check the connection and retry when the PDS is reachable.'
    case 'server':
      return 'Retry later; if it persists, check the user PDS status.'
    case 'validation':
      return 'Validate the record locally against the app lexicon before retrying.'
    case 'unknown':
      return 'Retry once, then inspect the underlying cause in logs if it still fails.'
  }
}

function formatRecordContext(context: Record<string, string | number | boolean | undefined>): string {
  const parts = [
    context.collection ? `collection ${context.collection}` : undefined,
    context.rkey ? `rkey ${context.rkey}` : undefined,
    context.repo ? `repo ${context.repo}` : undefined,
  ].filter(Boolean)

  return parts.length ? ` for ${parts.join(', ')}` : ''
}
