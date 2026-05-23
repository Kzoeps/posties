import { NOTE_ROTATION_DEG_X100_LIMITS } from '../../lib/config'
import { QUOTE_COLLECTION_NSID, SETTINGS_COLLECTION_NSID } from '../../lib/atproto/nsids'
import {
  createRepoRecord,
  deleteRepoRecord,
  getRepoRecord,
  getSettingsRecord,
  isStaleRecordCidError,
  listAllRepoRecords,
  putRepoRecord,
  putSettingsRecord,
  type AtprotoCid,
  type AtprotoCommitMeta,
  type AtprotoRecordValue,
  type AtprotoRepoCallOptions,
  type AtprotoRepoIdentifier,
  type AtprotoRepoReadAuth,
  type AtprotoRepoReadCallOptions,
  type AtprotoRepoRecord,
} from '../../lib/atproto/records'
import {
  formatValidationError,
  normalizeCanvasSettingsRecord,
  normalizeQuoteRecord,
  validateCanvasSettingsRecord,
  validateQuoteRecord,
} from '../../lib/atproto/validation'
import type {
  CanvasSettingsRecordInput,
  NormalizedCanvasSettingsRecord,
  NormalizedQuoteRecord,
  QuoteCreateInput as QuoteFieldsCreateInput,
  QuoteRecordInput,
  QuoteUpdateInput as QuoteFieldsUpdateInput,
  RemoteAtprotoRecord,
} from './quoteTypes'

const DEFAULT_PDS_LEXICON_VALIDATION = false

/** Shared options for quote repository calls against a user's PDS. */
export type QuoteRepositoryCallOptions = AtprotoRepoCallOptions & {
  /** Repo to read or write; defaults to the signed-in user's DID for authenticated calls. */
  repo?: AtprotoRepoIdentifier
}

/** Shared options for quote/settings reads that can run without OAuth when a PDS endpoint is provided. */
export type QuoteRepositoryReadOptions = AtprotoRepoReadCallOptions & {
  /** Repo DID to read. Required for public reads and used as the DID-scoped cache identity. */
  repo?: AtprotoRepoIdentifier
  /** Public read mode. Use `public` with `serviceEndpoint` for shareable `/:handle` pages. */
  auth?: AtprotoRepoReadAuth
}

/** Options for writes that may ask the PDS to validate custom records. */
export type QuoteRepositoryWriteOptions = QuoteRepositoryCallOptions & {
  /**
   * Whether to ask the PDS to validate the custom lexicon. Defaults to false
   * because app-side validation is mandatory and PDS custom-lexicon support can vary.
   */
  validate?: boolean
}

/** Input accepted by `listQuoteRecords` when reading all quote records from a repo. */
export type ListQuoteRecordsInput = QuoteRepositoryReadOptions & {
  /** Page size used for each `listRecords` call; defaults to the generic records helper limit. */
  limit?: number
  /** Whether records should be requested in reverse repo order before client-side sorting. */
  reverse?: boolean
}

/** Input accepted by `getQuoteRecord` when reading one quote record by key. */
export type GetQuoteRecordInput = QuoteRepositoryReadOptions & {
  /** Record key within `com.kzoeps.stickyquotes.canvas.quote`. */
  rkey: string
  /** Optional CID for reading a specific version instead of the latest record. */
  cid?: AtprotoCid
}

/** Input accepted by `createQuoteRecord` for creating a new sticky quote record. */
export type CreateQuoteRecordInput = QuoteFieldsCreateInput &
  QuoteRepositoryWriteOptions & {
    /** Optional deterministic rotation, mainly for tests/imports; omit to generate one with WebCrypto. */
    rotationDegX100?: number
  }

/** Input accepted by `updateQuoteRecord` for replacing an existing quote with merged changes. */
export type UpdateQuoteRecordInput = QuoteRepositoryWriteOptions & {
  /** Latest normalized quote record from the PDS or cache, including current URI, rkey, and CID. */
  current: NormalizedQuoteRecord
  /** Editable fields to merge into the existing record while preserving immutable `createdAt`. */
  updates: QuoteFieldsUpdateInput
  /** CID to use for compare-and-swap; defaults to `current.cid`. */
  swapRecord?: AtprotoCid
}

/** Input accepted by `deleteQuoteRecord` when deleting one quote by record key. */
export type DeleteQuoteRecordInput = QuoteRepositoryCallOptions & {
  /** Record key within `com.kzoeps.stickyquotes.canvas.quote`. */
  rkey: string
  /** Latest known record CID. When provided, stale deletes fail instead of silently deleting newer data. */
  cid?: AtprotoCid
}

/** Result returned by `deleteQuoteRecord` after a PDS delete succeeds. */
export type DeleteQuoteRecordOutput = {
  /** Deleted record key, useful for optimistic cache reconciliation. */
  rkey: string
  /** Commit metadata returned by the PDS when available. */
  commit?: AtprotoCommitMeta
}

/** Editable settings fields callers may write to the singleton settings record. */
export type CanvasSettingsUpdateInput = Pick<CanvasSettingsRecordInput, 'defaultColor' | 'lastViewport'>

/** Input accepted by `getCanvasSettingsRecord` when reading the singleton settings record. */
export type GetCanvasSettingsRecordInput = QuoteRepositoryReadOptions & {
  /** Optional CID for reading a specific settings version instead of the latest record. */
  cid?: AtprotoCid
}

/** Input accepted by `putCanvasSettingsRecord` for creating or replacing the singleton settings record. */
export type PutCanvasSettingsRecordInput = QuoteRepositoryWriteOptions & {
  /** Settings fields to merge into `current`, or use as the full v1 settings body when no current record exists. */
  settings: CanvasSettingsUpdateInput
  /** Latest settings record, if one exists; its CID is used for compare-and-swap by default. */
  current?: NormalizedCanvasSettingsRecord | null
  /** CID to use for compare-and-swap; defaults to `current.cid` when `current` exists. */
  swapRecord?: AtprotoCid | null
}

/** Re-export used by query/error code to detect stale CID compare-and-swap failures. */
export { isStaleRecordCidError }

/**
 * Lists every quote record in the user's public PDS collection, validates each value,
 * normalizes URI/CID/rkey metadata, and sorts by `zIndex` then `createdAt`.
 */
export async function listQuoteRecords(input: ListQuoteRecordsInput = {}): Promise<NormalizedQuoteRecord[]> {
  const records = await listAllRepoRecords<AtprotoRecordValue>({
    repo: input.repo,
    collection: QUOTE_COLLECTION_NSID,
    limit: input.limit,
    reverse: input.reverse,
    auth: input.auth,
    serviceEndpoint: input.serviceEndpoint,
    signal: input.signal,
  })

  return records
    .map((record) => normalizeQuoteRecordForApi(record, 'list quote records'))
    .sort(compareQuoteRecords)
}

/**
 * Reads one quote record by rkey and returns the validated, normalized record.
 * Use this after stale-CID conflicts to refetch the latest server value before merging.
 */
export async function getQuoteRecord(input: GetQuoteRecordInput): Promise<NormalizedQuoteRecord> {
  const record = await getRepoRecord<AtprotoRecordValue>({
    repo: input.repo,
    collection: QUOTE_COLLECTION_NSID,
    rkey: input.rkey,
    cid: input.cid,
    auth: input.auth,
    serviceEndpoint: input.serviceEndpoint,
    signal: input.signal,
  })

  return normalizeQuoteRecordForApi(record, 'get quote record')
}

/**
 * Creates a new quote record with generated persistent rotation and creation/update timestamps.
 * The returned record contains the PDS-assigned AT URI, CID, parsed rkey, and validated fields.
 */
export async function createQuoteRecord(input: CreateQuoteRecordInput): Promise<NormalizedQuoteRecord> {
  const record = buildNewQuoteRecord(input)
  const write = await createRepoRecord<AtprotoRecordValue>({
    repo: input.repo,
    collection: QUOTE_COLLECTION_NSID,
    record: toAtprotoRecordValue(record),
    validate: input.validate ?? DEFAULT_PDS_LEXICON_VALIDATION,
    signal: input.signal,
  })

  return normalizeQuoteRecordForApi(
    {
      uri: write.uri,
      cid: write.cid,
      value: record,
    },
    'create quote record',
  )
}

/**
 * Replaces an existing quote record by merging editable updates into the current value.
 * `createdAt` and `rotationDegX100` are preserved, `updatedAt` is refreshed, and `swapRecord`
 * defaults to the current CID so stale clients cannot silently overwrite newer PDS data.
 */
export async function updateQuoteRecord(input: UpdateQuoteRecordInput): Promise<NormalizedQuoteRecord> {
  const record = buildUpdatedQuoteRecord(input.current, input.updates)
  const write = await putRepoRecord<AtprotoRecordValue>({
    repo: input.repo,
    collection: QUOTE_COLLECTION_NSID,
    rkey: input.current.rkey,
    record: toAtprotoRecordValue(record),
    validate: input.validate ?? DEFAULT_PDS_LEXICON_VALIDATION,
    swapRecord: input.swapRecord ?? input.current.cid,
    signal: input.signal,
  })

  return normalizeQuoteRecordForApi(
    {
      uri: write.uri,
      cid: write.cid,
      value: record,
    },
    'update quote record',
  )
}

/**
 * Deletes one quote record by rkey. Pass the latest CID to make stale deletes fail with
 * `isStaleRecordCidError(...)` instead of deleting a record that changed remotely.
 */
export async function deleteQuoteRecord(input: DeleteQuoteRecordInput): Promise<DeleteQuoteRecordOutput> {
  const output = await deleteRepoRecord({
    repo: input.repo,
    collection: QUOTE_COLLECTION_NSID,
    rkey: input.rkey,
    swapRecord: input.cid,
    signal: input.signal,
  })

  return {
    rkey: input.rkey,
    commit: output.commit,
  }
}

/**
 * Reads the singleton canvas settings record. Missing settings return `null` so callers can
 * intentionally create defaults with `putCanvasSettingsRecord` instead of treating first run as an error.
 */
export async function getCanvasSettingsRecord(
  input: GetCanvasSettingsRecordInput = {},
): Promise<NormalizedCanvasSettingsRecord | null> {
  try {
    const record = await getSettingsRecord<AtprotoRecordValue>({
      repo: input.repo,
      cid: input.cid,
      auth: input.auth,
      serviceEndpoint: input.serviceEndpoint,
      signal: input.signal,
    })

    return normalizeCanvasSettingsRecordForApi(record, 'get canvas settings record')
  } catch (error) {
    if (isMissingRecordError(error)) return null
    throw error
  }
}

/**
 * Creates or replaces the singleton settings record at rkey `self` and returns the normalized value.
 * When `current` is provided, its CID is used as `swapRecord` so concurrent settings edits conflict safely.
 */
export async function putCanvasSettingsRecord(
  input: PutCanvasSettingsRecordInput,
): Promise<NormalizedCanvasSettingsRecord> {
  const record = buildCanvasSettingsRecord(input.settings, input.current)
  const write = await putSettingsRecord<AtprotoRecordValue>({
    repo: input.repo,
    record: toAtprotoRecordValue(record),
    validate: input.validate ?? DEFAULT_PDS_LEXICON_VALIDATION,
    swapRecord: input.swapRecord !== undefined ? input.swapRecord : input.current?.cid,
    signal: input.signal,
  })

  return normalizeCanvasSettingsRecordForApi(
    {
      uri: write.uri,
      cid: write.cid,
      value: record,
    },
    'put canvas settings record',
  )
}

/**
 * Generates a persistent sticky-note rotation in hundredths of a degree using WebCrypto.
 * The value is always within the creation bounds from config and should be stored once at create time.
 */
export function generateQuoteRotationDegX100(randomSource: Pick<Crypto, 'getRandomValues'> = globalThis.crypto): number {
  if (!randomSource?.getRandomValues) {
    throw new Error(
      'Could not generate quote rotation. What went wrong: WebCrypto getRandomValues is unavailable. Why it matters: note tilt must be generated once and stored on create. What to do: run this in a secure browser context or pass a test random source.',
    )
  }

  const min = NOTE_ROTATION_DEG_X100_LIMITS.createMin
  const max = NOTE_ROTATION_DEG_X100_LIMITS.createMax
  const range = max - min + 1
  const random = new Uint32Array(1)
  randomSource.getRandomValues(random)

  return min + (random[0] % range)
}

function buildNewQuoteRecord(input: CreateQuoteRecordInput): QuoteRecordInput {
  const now = new Date().toISOString()
  return validateQuoteRecord({
    $type: QUOTE_COLLECTION_NSID,
    schemaVersion: 1,
    text: input.text,
    author: input.author,
    sourceTitle: input.sourceTitle,
    sourceUri: input.sourceUri,
    position: input.position,
    size: input.size,
    rotationDegX100: input.rotationDegX100 ?? generateQuoteRotationDegX100(),
    color: input.color,
    zIndex: input.zIndex,
    createdAt: now,
    updatedAt: now,
  })
}

function buildUpdatedQuoteRecord(current: NormalizedQuoteRecord, updates: QuoteFieldsUpdateInput): QuoteRecordInput {
  return validateQuoteRecord({
    ...quoteRecordValueFromNormalized(current),
    ...updates,
    createdAt: current.createdAt,
    rotationDegX100: current.rotationDegX100,
    updatedAt: new Date().toISOString(),
  })
}

function buildCanvasSettingsRecord(
  settings: CanvasSettingsUpdateInput,
  current: NormalizedCanvasSettingsRecord | null | undefined,
): CanvasSettingsRecordInput {
  return validateCanvasSettingsRecord({
    ...(current ? canvasSettingsValueFromNormalized(current) : { $type: SETTINGS_COLLECTION_NSID, schemaVersion: 1 }),
    ...settings,
    updatedAt: new Date().toISOString(),
  })
}

function quoteRecordValueFromNormalized(current: NormalizedQuoteRecord): QuoteRecordInput {
  const { uri: _uri, cid: _cid, rkey: _rkey, id: _id, ...record } = current
  return record
}

function canvasSettingsValueFromNormalized(current: NormalizedCanvasSettingsRecord): CanvasSettingsRecordInput {
  const { uri: _uri, cid: _cid, rkey: _rkey, ...record } = current
  return record
}

function normalizeQuoteRecordForApi(record: AtprotoRepoRecord<AtprotoRecordValue>, action: string): NormalizedQuoteRecord {
  try {
    return normalizeQuoteRecord(toRemoteRecord(record, 'quote record'))
  } catch (error) {
    throw new Error(
      `Could not ${action}. What went wrong: ${formatValidationError(error, 'quote record')} What to do: refresh the records from ${QUOTE_COLLECTION_NSID}; if the problem persists, inspect the malformed public PDS record and skip or repair it before retrying.`,
    )
  }
}

function normalizeCanvasSettingsRecordForApi(
  record: AtprotoRepoRecord<AtprotoRecordValue>,
  action: string,
): NormalizedCanvasSettingsRecord {
  try {
    return normalizeCanvasSettingsRecord(toRemoteRecord(record, 'canvas settings record'))
  } catch (error) {
    throw new Error(
      `Could not ${action}. What went wrong: ${formatValidationError(error, 'canvas settings record')} What to do: refresh ${SETTINGS_COLLECTION_NSID}/self; if the problem persists, delete or repair the malformed public PDS settings record before retrying.`,
    )
  }
}

function toRemoteRecord(record: AtprotoRepoRecord<AtprotoRecordValue>, subject: string): RemoteAtprotoRecord {
  if (!record.cid) {
    throw new Error(
      `Invalid ${subject} metadata. What went wrong: the PDS response did not include a CID for ${record.uri}. Why it matters: the app needs the CID for compare-and-swap updates. What to do: refetch the record and retry after the PDS returns complete metadata.`,
    )
  }

  return {
    uri: record.uri,
    cid: record.cid,
    value: record.value,
  }
}

function toAtprotoRecordValue(record: QuoteRecordInput | CanvasSettingsRecordInput): AtprotoRecordValue {
  return record as unknown as AtprotoRecordValue
}

function compareQuoteRecords(left: NormalizedQuoteRecord, right: NormalizedQuoteRecord): number {
  const zIndexDiff = (left.zIndex ?? 0) - (right.zIndex ?? 0)
  if (zIndexDiff !== 0) return zIndexDiff

  const createdAtDiff = Date.parse(left.createdAt) - Date.parse(right.createdAt)
  if (createdAtDiff !== 0) return createdAtDiff

  return left.uri.localeCompare(right.uri)
}

function isMissingRecordError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const maybeError = error as { kind?: unknown; status?: unknown; xrpcError?: unknown; cause?: unknown }
    if (maybeError.kind === 'not-found' || maybeError.status === 404 || maybeError.xrpcError === 'RecordNotFound') {
      return true
    }
    if (maybeError.cause) return isMissingRecordError(maybeError.cause)
  }

  return false
}
