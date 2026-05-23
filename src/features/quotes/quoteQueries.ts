import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import { QUOTE_COLLECTION_NSID, SETTINGS_COLLECTION_NSID, SETTINGS_RECORD_KEY } from '../../lib/atproto/nsids'
import { isAtprotoRecordConflictError, isStaleRecordCidError, type AtprotoCid } from '../../lib/atproto/records'
import {
  createQuoteRecord,
  deleteQuoteRecord,
  generateQuoteRotationDegX100,
  getCanvasSettingsRecord,
  getQuoteRecord,
  listQuoteRecords,
  putCanvasSettingsRecord,
  updateQuoteRecord,
  type CanvasSettingsUpdateInput,
  type QuoteRepositoryReadOptions,
} from './quoteApi'
import type {
  CanvasPosition,
  NormalizedCanvasSettingsRecord,
  NormalizedQuoteRecord,
  QuoteCreateInput,
  QuoteUpdateInput,
  StickyNoteStatus,
} from './quoteTypes'

const SIGNED_OUT_DID_SCOPE = '__signed_out__'
const createRotationByInput = new WeakMap<object, number>()
const updateTargetByInput = new WeakMap<object, NormalizedQuoteRecord>()
const deleteTargetByInput = new WeakMap<object, NormalizedQuoteRecord>()
const settingsTargetByInput = new WeakMap<object, NormalizedCanvasSettingsRecord | null>()

/** Query keys for public quote records. Use `byDid` so every cache entry is scoped to one ATProto account. */
export const quoteQueryKeys = {
  /** Root key for all quote-record queries. */
  all: ['quotes'] as const,
  /** Quote-record list for one signed-in DID. */
  byDid: (did: string) => ['quotes', did] as const,
} as const

/** Query keys for canvas settings records. Use `byDid` so settings cannot leak between accounts. */
export const canvasSettingsQueryKeys = {
  /** Root key for all canvas-settings queries. */
  all: ['canvasSettings'] as const,
  /** Singleton canvas settings record for one signed-in DID. */
  byDid: (did: string) => ['canvasSettings', did] as const,
} as const

/** Mutation action names stored in errors and optimistic cache records for future retry UI. */
export type QuoteMutationAction = 'create' | 'update' | 'move' | 'delete' | 'settings'

/** Extra client-side state attached to cached quote records while optimistic mutations are pending or failed. */
export type QuoteCacheState<TInput = unknown> = {
  /** Persistence state that sticky-note UI can render while a mutation is pending or failed. */
  status?: StickyNoteStatus
  /** User-facing error from the latest failed mutation for this note. */
  errorMessage?: string
  /** Button label for retrying the failed mutation; conflict failures use stronger wording than normal retries. */
  retryLabel?: string
  /** True when this note exists only in the local optimistic cache and has no PDS record yet. */
  isTemporary?: boolean
  /** Retry metadata retained after a failed mutation so a future UI can re-submit the same change. */
  failedMutation?: QuoteMutationFailure<TInput>
}

/** Quote record shape stored in TanStack Query, including optional optimistic mutation state. */
export type QuoteCacheRecord<TInput = unknown> = NormalizedQuoteRecord & QuoteCacheState<TInput>

/** Extra client-side state attached to the singleton settings cache while settings writes are pending or failed. */
export type CanvasSettingsCacheState<TInput = unknown> = {
  /** Whether a settings mutation is pending, failed, or already persisted. */
  status?: 'saving' | 'error' | 'idle'
  /** User-facing error from the latest failed settings mutation. */
  errorMessage?: string
  /** True when settings were optimistically created before the PDS returned real URI/CID metadata. */
  isTemporary?: boolean
  /** Retry metadata retained after a failed settings mutation. */
  failedMutation?: QuoteMutationFailure<TInput>
}

/** Canvas settings record shape stored in TanStack Query, including optional optimistic mutation state. */
export type CanvasSettingsCacheRecord<TInput = unknown> = NormalizedCanvasSettingsRecord & CanvasSettingsCacheState<TInput>

/** Retry metadata stored on failed optimistic records and on thrown query errors. */
export type QuoteMutationFailure<TInput = unknown> = {
  /** Mutation that failed. */
  action: QuoteMutationAction
  /** Original mutation variables that can be offered to a retry control later. */
  input: TInput
  /** User-facing error message explaining what failed and what to do next. */
  message: string
  /** True when the failure came from a stale CID or other PDS conflict response. */
  isConflict?: boolean
  /** ISO timestamp for showing when the cached failure happened. */
  failedAt: string
}

/** Error thrown by quote/settings query hooks with actionable retry metadata. */
export class QuoteQueryError<TInput = unknown> extends Error {
  /** Query or mutation action that failed. */
  readonly action: string
  /** DID whose scoped query or mutation failed, when known. */
  readonly did?: string
  /** Original lower-level API, validation, network, or PDS error. */
  readonly cause?: unknown
  /** Original mutation variables retained for retry UI. */
  readonly retryInput?: TInput
  /** True when the failure came from a stale CID or other PDS conflict response. */
  readonly isConflict: boolean
  /** Latest remote quote refetched after a conflict, when available. */
  readonly latestQuote?: NormalizedQuoteRecord

  constructor(
    action: string,
    message: string,
    options: {
      did?: string
      cause?: unknown
      retryInput?: TInput
      isConflict?: boolean
      latestQuote?: NormalizedQuoteRecord
    } = {},
  ) {
    super(message)
    this.name = 'QuoteQueryError'
    this.action = action
    this.did = options.did
    this.cause = options.cause
    this.retryInput = options.retryInput
    this.isConflict = options.isConflict ?? false
    this.latestQuote = options.latestQuote
  }
}

/** Variables accepted by `useCreateQuoteMutation` for creating a new sticky quote record. */
export type CreateQuoteMutationInput = QuoteCreateInput & {
  /** Optional deterministic rotation in hundredths of a degree; omit to generate one before optimistic create. */
  rotationDegX100?: number
}

/** Variables accepted by `useUpdateQuoteMutation` for editing text, metadata, color, size, position, or z-index. */
export type UpdateQuoteMutationInput = {
  /** UI id, AT URI, or rkey of the quote to update. Optional when `current` is provided. */
  id?: string
  /** Latest persisted quote record, if the caller already has it. */
  current?: QuoteCacheRecord | NormalizedQuoteRecord
  /** Editable fields to merge into the persisted quote record. */
  updates: QuoteUpdateInput
  /** Optional compare-and-swap CID override; defaults to the latest known quote CID. */
  swapRecord?: AtprotoCid
}

/** Variables accepted by `useMoveQuoteMutation` for persisting final drag coordinates. */
export type MoveQuoteMutationInput = {
  /** UI id, AT URI, or rkey of the quote to move. Optional when `current` is provided. */
  id?: string
  /** Latest persisted quote record, if the caller already has it. */
  current?: QuoteCacheRecord | NormalizedQuoteRecord
  /** Final integer world coordinates to persist after drag end. */
  position: CanvasPosition
  /** Optional compare-and-swap CID override; defaults to the latest known quote CID. */
  swapRecord?: AtprotoCid
}

/** Variables accepted by `useDeleteQuoteMutation` for deleting one sticky quote record. */
export type DeleteQuoteMutationInput = {
  /** UI id, AT URI, or rkey of the quote to delete. Optional when `current` is provided. */
  id?: string
  /** Latest persisted quote record, if the caller already has it. */
  current?: QuoteCacheRecord | NormalizedQuoteRecord
  /** Record key override for callers that only have PDS metadata. */
  rkey?: string
  /** Optional compare-and-swap CID override; defaults to the latest known quote CID. */
  cid?: AtprotoCid
}

/** Variables accepted by `useUpdateCanvasSettingsMutation` for writing the singleton settings record. */
export type UpdateCanvasSettingsMutationInput = {
  /** Settings fields to merge into the current settings record or create as the v1 singleton body. */
  settings: CanvasSettingsUpdateInput
  /** Latest settings record, if the caller already has it. */
  current?: CanvasSettingsCacheRecord | NormalizedCanvasSettingsRecord | null
  /** Optional compare-and-swap CID override; defaults to the current settings CID when available. */
  swapRecord?: AtprotoCid | null
}

/** Context retained by quote mutations so errors can roll back optimistic cache changes. */
export type QuoteMutationContext<TInput = unknown> = {
  /** DID whose quote query cache was modified. */
  did: string
  /** Quote list before the optimistic update. */
  previousQuotes?: QuoteCacheRecord[]
  /** Persisted quote targeted by update/move/delete mutations. */
  targetQuote?: NormalizedQuoteRecord
  /** Temporary id inserted for optimistic create mutations. */
  optimisticId?: string
  /** Original mutation variables. */
  input: TInput
}

/** Context retained by settings mutations so errors can roll back optimistic cache changes. */
export type CanvasSettingsMutationContext<TInput = unknown> = {
  /** DID whose settings query cache was modified. */
  did: string
  /** Settings record before the optimistic update. */
  previousSettings?: CanvasSettingsCacheRecord | null
  /** Original mutation variables. */
  input: TInput
}

/** Query hook for all quote records in one user's public PDS collection, cached strictly by owner DID. */
export function useQuotesQuery(
  did: string | null | undefined,
  readOptions: Pick<QuoteRepositoryReadOptions, 'auth' | 'serviceEndpoint'> = {},
): UseQueryResult<QuoteCacheRecord[], QuoteQueryError> {
  const scopedDid = queryDidScope(did)

  return useQuery({
    queryKey: quoteQueryKeys.byDid(scopedDid),
    enabled: Boolean(did),
    queryFn: async ({ signal }) => {
      const repo = requireDid(did, 'list quote records')
      try {
        const records = await listQuoteRecords({ repo, auth: readOptions.auth, serviceEndpoint: readOptions.serviceEndpoint, signal })
        return records.map(toIdleQuoteCacheRecord)
      } catch (error) {
        throw toQuoteQueryError('list quote records', error, { did: repo })
      }
    },
  })
}

/** Query hook for the singleton canvas settings record in one user's public PDS collection, cached by owner DID. */
export function useCanvasSettingsQuery(
  did: string | null | undefined,
  readOptions: Pick<QuoteRepositoryReadOptions, 'auth' | 'serviceEndpoint'> = {},
): UseQueryResult<CanvasSettingsCacheRecord | null, QuoteQueryError> {
  const scopedDid = queryDidScope(did)

  return useQuery({
    queryKey: canvasSettingsQueryKeys.byDid(scopedDid),
    enabled: Boolean(did),
    queryFn: async ({ signal }) => {
      const repo = requireDid(did, 'get canvas settings')
      try {
        const record = await getCanvasSettingsRecord({ repo, auth: readOptions.auth, serviceEndpoint: readOptions.serviceEndpoint, signal })
        return record ? toIdleCanvasSettingsCacheRecord(record) : null
      } catch (error) {
        throw toQuoteQueryError('get canvas settings', error, { did: repo })
      }
    },
  })
}

/** Mutation hook for creating a quote with a temporary saving note and replacing it with the PDS record on success. */
export function useCreateQuoteMutation(
  did: string | null | undefined,
): UseMutationResult<QuoteCacheRecord, QuoteQueryError<CreateQuoteMutationInput>, CreateQuoteMutationInput, QuoteMutationContext<CreateQuoteMutationInput>> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input) => {
      const repo = requireDid(did, 'create quote')
      const rotationDegX100 = getOrCreateRotation(input)
      try {
        const created = await createQuoteRecord({ ...input, rotationDegX100, repo })
        return toIdleQuoteCacheRecord(created)
      } catch (error) {
        throw toQuoteQueryError('create quote', error, { did: repo, retryInput: { ...input, rotationDegX100 } })
      }
    },
    onMutate: async (input) => {
      const repo = requireDid(did, 'create quote')
      const rotationDegX100 = getOrCreateRotation(input)
      const key = quoteQueryKeys.byDid(repo)
      await queryClient.cancelQueries({ queryKey: key })
      const previousQuotes = getQuoteCache(queryClient, repo)
      const optimisticId = temporaryRecordId('quote')
      const optimisticQuote = buildOptimisticQuote({ ...input, rotationDegX100 }, optimisticId)
      queryClient.setQueryData<QuoteCacheRecord[]>(key, (current) => sortQuotes([...(current ?? []), optimisticQuote]))

      return { did: repo, previousQuotes, optimisticId, input: { ...input, rotationDegX100 } }
    },
    onError: (_error, _input, context) => {
      if (context) {
        queryClient.setQueryData<QuoteCacheRecord[]>(quoteQueryKeys.byDid(context.did), context.previousQuotes ?? [])
      }
    },
    onSuccess: (created, _input, context) => {
      const repo = context?.did ?? requireDid(did, 'create quote')
      queryClient.setQueryData<QuoteCacheRecord[]>(quoteQueryKeys.byDid(repo), (current) =>
        replaceOptimisticQuote(current ?? [], context?.optimisticId, created),
      )
    },
    onSettled: (_data, error, _input, context) => {
      if (context?.did && !error) void queryClient.invalidateQueries({ queryKey: quoteQueryKeys.byDid(context.did) })
    },
  })
}

/** Mutation hook for editing persisted quote fields with optimistic cache updates and rollback-on-error. */
export function useUpdateQuoteMutation(
  did: string | null | undefined,
): UseMutationResult<QuoteCacheRecord, QuoteQueryError<UpdateQuoteMutationInput>, UpdateQuoteMutationInput, QuoteMutationContext<UpdateQuoteMutationInput>> {
  return usePersistQuoteUpdateMutation(did, 'update', (input) => input.updates)
}

/** Alias for `useUpdateQuoteMutation` for callers that use edit wording in UI code. */
export const useEditQuoteMutation = useUpdateQuoteMutation

/** Mutation hook for persisting final sticky-note drag coordinates with an optimistic position update. */
export function useMoveQuoteMutation(
  did: string | null | undefined,
): UseMutationResult<QuoteCacheRecord, QuoteQueryError<MoveQuoteMutationInput>, MoveQuoteMutationInput, QuoteMutationContext<MoveQuoteMutationInput>> {
  return usePersistQuoteUpdateMutation(did, 'move', (input) => ({ position: input.position }))
}

/** Mutation hook for deleting a quote with immediate removal and rollback when the PDS delete fails. */
export function useDeleteQuoteMutation(
  did: string | null | undefined,
): UseMutationResult<void, QuoteQueryError<DeleteQuoteMutationInput>, DeleteQuoteMutationInput, QuoteMutationContext<DeleteQuoteMutationInput>> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input) => {
      const repo = requireDid(did, 'delete quote')
      const target = deleteTargetByInput.get(input) ?? resolvePersistedQuoteTarget(getQuoteCache(queryClient, repo), input, 'delete quote')
      try {
        await deleteQuoteRecord({ repo, rkey: input.rkey ?? target.rkey, cid: input.cid ?? target.cid })
      } catch (error) {
        if (isRecordConflict(error)) {
          const latestQuote = await refetchQuoteAfterConflict(repo, target, 'delete quote', error)
          throw toQuoteConflictError('delete quote', error, {
            did: repo,
            retryInput: input,
            latestQuote,
            detail:
              'The note changed on the PDS before it could be deleted, so the app restored the latest copy instead of deleting newer data silently.',
          })
        }

        throw toQuoteQueryError('delete quote', error, { did: repo, retryInput: input })
      }
    },
    onMutate: async (input) => {
      const repo = requireDid(did, 'delete quote')
      const key = quoteQueryKeys.byDid(repo)
      await queryClient.cancelQueries({ queryKey: key })
      const previousQuotes = getQuoteCache(queryClient, repo)
      const target = resolvePersistedQuoteTarget(previousQuotes, input, 'delete quote')
      deleteTargetByInput.set(input, target)
      queryClient.setQueryData<QuoteCacheRecord[]>(key, (current) => (current ?? []).filter((quote) => !matchesQuote(quote, target)))

      return { did: repo, previousQuotes, targetQuote: target, input }
    },
    onError: (error, input, context) => {
      if (!context) return
      queryClient.setQueryData<QuoteCacheRecord[]>(
        quoteQueryKeys.byDid(context.did),
        markQuoteFailure(context.previousQuotes ?? [], context.targetQuote, 'delete', input, error),
      )
    },
    onSuccess: (_data, _input, context) => {
      if (!context) return
      queryClient.setQueryData<QuoteCacheRecord[]>(quoteQueryKeys.byDid(context.did), (current) =>
        (current ?? []).filter((quote) => !matchesQuote(quote, context.targetQuote)),
      )
    },
    onSettled: (_data, error, _input, context) => {
      if (context?.did && !error) void queryClient.invalidateQueries({ queryKey: quoteQueryKeys.byDid(context.did) })
    },
  })
}

/** Mutation hook for writing the singleton canvas settings record with optimistic cache updates. */
export function useUpdateCanvasSettingsMutation(
  did: string | null | undefined,
): UseMutationResult<
  CanvasSettingsCacheRecord,
  QuoteQueryError<UpdateCanvasSettingsMutationInput>,
  UpdateCanvasSettingsMutationInput,
  CanvasSettingsMutationContext<UpdateCanvasSettingsMutationInput>
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input) => {
      const repo = requireDid(did, 'update canvas settings')
      const current = settingsTargetByInput.get(input) ?? persistedSettingsOrNull(input.current)
      try {
        const updated = await putCanvasSettingsRecord({
          repo,
          settings: input.settings,
          current,
          swapRecord: input.swapRecord !== undefined ? input.swapRecord : current?.cid,
        })
        return toIdleCanvasSettingsCacheRecord(updated)
      } catch (error) {
        throw toQuoteQueryError('update canvas settings', error, { did: repo, retryInput: input })
      }
    },
    onMutate: async (input) => {
      const repo = requireDid(did, 'update canvas settings')
      const key = canvasSettingsQueryKeys.byDid(repo)
      await queryClient.cancelQueries({ queryKey: key })
      const previousSettings = queryClient.getQueryData<CanvasSettingsCacheRecord | null>(key)
      const current = persistedSettingsOrNull(input.current) ?? persistedSettingsOrNull(previousSettings)
      settingsTargetByInput.set(input, current)
      queryClient.setQueryData<CanvasSettingsCacheRecord | null>(key, buildOptimisticSettings(repo, input.settings, previousSettings))

      return { did: repo, previousSettings, input }
    },
    onError: (error, input, context) => {
      if (!context) return
      queryClient.setQueryData<CanvasSettingsCacheRecord | null>(
        canvasSettingsQueryKeys.byDid(context.did),
        markSettingsFailure(context.previousSettings, input, error),
      )
    },
    onSuccess: (settings, _input, context) => {
      const repo = context?.did ?? requireDid(did, 'update canvas settings')
      queryClient.setQueryData<CanvasSettingsCacheRecord | null>(canvasSettingsQueryKeys.byDid(repo), settings)
    },
    onSettled: (_data, error, _input, context) => {
      if (context?.did && !error) void queryClient.invalidateQueries({ queryKey: canvasSettingsQueryKeys.byDid(context.did) })
    },
  })
}

function usePersistQuoteUpdateMutation<TInput extends UpdateQuoteMutationInput | MoveQuoteMutationInput>(
  did: string | null | undefined,
  action: 'update' | 'move',
  updatesForInput: (input: TInput) => QuoteUpdateInput,
): UseMutationResult<QuoteCacheRecord, QuoteQueryError<TInput>, TInput, QuoteMutationContext<TInput>> {
  const queryClient = useQueryClient()
  const actionLabel = action === 'move' ? 'move quote' : 'update quote'

  return useMutation({
    mutationFn: async (input) => {
      const repo = requireDid(did, actionLabel)
      const target = updateTargetByInput.get(input) ?? resolvePersistedQuoteTarget(getQuoteCache(queryClient, repo), input, actionLabel)
      const updates = updatesForInput(input)
      try {
        const updated = await updateQuoteRecord({
          repo,
          current: target,
          updates,
          swapRecord: input.swapRecord ?? target.cid,
        })
        return toIdleQuoteCacheRecord(updated)
      } catch (error) {
        if (isRecordConflict(error)) {
          const latestQuote = await refetchQuoteAfterConflict(repo, target, actionLabel, error)
          if (canAutoMergePositionOnlyConflict(updates, target, latestQuote)) {
            try {
              const merged = await updateQuoteRecord({
                repo,
                current: latestQuote,
                updates,
                swapRecord: latestQuote.cid,
              })
              return toIdleQuoteCacheRecord(merged)
            } catch (mergeError) {
              throw toQuoteConflictError(actionLabel, mergeError, {
                did: repo,
                retryInput: input,
                latestQuote,
                detail:
                  'The app refetched the latest PDS record and tried to merge your position-only change, but the retry failed. Your local change is still available on this note.',
              })
            }
          }

          throw toQuoteConflictError(actionLabel, error, {
            did: repo,
            retryInput: input,
            latestQuote,
            detail: positionChanged(target, latestQuote)
              ? 'The note position also changed on the PDS, so the app did not overwrite that remote movement silently.'
              : 'The note changed on the PDS before this save, so the app refreshed the latest copy and kept your local change available for an explicit retry.',
          })
        }

        throw toQuoteQueryError(actionLabel, error, { did: repo, retryInput: input })
      }
    },
    onMutate: async (input) => {
      const repo = requireDid(did, actionLabel)
      const key = quoteQueryKeys.byDid(repo)
      await queryClient.cancelQueries({ queryKey: key })
      const previousQuotes = getQuoteCache(queryClient, repo)
      const target = resolvePersistedQuoteTarget(previousQuotes, input, actionLabel)
      updateTargetByInput.set(input, target)
      queryClient.setQueryData<QuoteCacheRecord[]>(key, (current) =>
        sortQuotes(
          (current ?? []).map((quote) =>
            matchesQuote(quote, target)
              ? {
                  ...quote,
                  ...updatesForInput(input),
                  updatedAt: new Date().toISOString(),
                  status: 'saving',
                  errorMessage: undefined,
                  retryLabel: undefined,
                  failedMutation: undefined,
                }
              : quote,
          ),
        ),
      )

      return { did: repo, previousQuotes, targetQuote: target, input }
    },
    onError: (error, input, context) => {
      if (!context) return
      queryClient.setQueryData<QuoteCacheRecord[]>(
        quoteQueryKeys.byDid(context.did),
        markQuoteFailure(context.previousQuotes ?? [], context.targetQuote, action, input, error),
      )
    },
    onSuccess: (updated, _input, context) => {
      const repo = context?.did ?? requireDid(did, actionLabel)
      queryClient.setQueryData<QuoteCacheRecord[]>(quoteQueryKeys.byDid(repo), (current) =>
        replacePersistedQuote(current ?? [], context?.targetQuote, updated),
      )
    },
    onSettled: (_data, error, _input, context) => {
      if (context?.did && !error) void queryClient.invalidateQueries({ queryKey: quoteQueryKeys.byDid(context.did) })
    },
  })
}

function queryDidScope(did: string | null | undefined): string {
  return did || SIGNED_OUT_DID_SCOPE
}

function requireDid(did: string | null | undefined, action: string): string {
  if (did) return did
  throw new QuoteQueryError(
    action,
    `Could not ${action}. What went wrong: no active DID was provided for the account-scoped query key. What to do: restore the OAuth session first, then call this hook with the signed-in DID.`,
  )
}

function getQuoteCache(queryClient: QueryClient, did: string): QuoteCacheRecord[] {
  return queryClient.getQueryData<QuoteCacheRecord[]>(quoteQueryKeys.byDid(did)) ?? []
}

function getOrCreateRotation(input: CreateQuoteMutationInput): number {
  if (input.rotationDegX100 !== undefined) return input.rotationDegX100
  const existing = createRotationByInput.get(input)
  if (existing !== undefined) return existing

  const generated = generateQuoteRotationDegX100()
  createRotationByInput.set(input, generated)
  return generated
}

function buildOptimisticQuote(input: CreateQuoteMutationInput & { rotationDegX100: number }, optimisticId: string): QuoteCacheRecord<CreateQuoteMutationInput> {
  const now = new Date().toISOString()
  return {
    uri: optimisticId,
    cid: optimisticId,
    rkey: optimisticId,
    id: optimisticId,
    $type: QUOTE_COLLECTION_NSID,
    schemaVersion: 1,
    text: input.text,
    author: input.author,
    sourceTitle: input.sourceTitle,
    sourceUri: input.sourceUri,
    position: input.position,
    size: input.size,
    rotationDegX100: input.rotationDegX100,
    color: input.color,
    zIndex: input.zIndex,
    createdAt: now,
    updatedAt: now,
    status: 'saving',
    isTemporary: true,
  }
}

function buildOptimisticSettings(
  did: string,
  settings: CanvasSettingsUpdateInput,
  previous: CanvasSettingsCacheRecord | null | undefined,
): CanvasSettingsCacheRecord<UpdateCanvasSettingsMutationInput> {
  const now = new Date().toISOString()
  const base = previous ?? {
    uri: `at://${did}/${SETTINGS_COLLECTION_NSID}/${SETTINGS_RECORD_KEY}`,
    cid: temporaryRecordId('settings-cid'),
    rkey: SETTINGS_RECORD_KEY,
    $type: SETTINGS_COLLECTION_NSID,
    schemaVersion: 1,
    updatedAt: now,
    isTemporary: true,
  }

  return {
    ...base,
    ...settings,
    updatedAt: now,
    status: 'saving',
    errorMessage: undefined,
    failedMutation: undefined,
  }
}

function resolvePersistedQuoteTarget<TInput extends { id?: string; current?: QuoteCacheRecord | NormalizedQuoteRecord }>(
  quotes: QuoteCacheRecord[],
  input: TInput,
  action: string,
): NormalizedQuoteRecord {
  const cacheRecord = input.current ? toQuoteCacheRecord(input.current) : findQuoteByRef(quotes, input.id)
  if (!cacheRecord) {
    throw new QuoteQueryError(
      action,
      `Could not ${action}. What went wrong: the quote was not found in the DID-scoped query cache. What to do: refetch quote records for this account, then retry with the latest quote id or record metadata.`,
      { retryInput: input },
    )
  }

  if (cacheRecord.isTemporary) {
    throw new QuoteQueryError(
      action,
      `Could not ${action}. What went wrong: the quote is still a temporary optimistic record without a real PDS rkey/CID. What to do: wait for the create request to finish, then retry using the persisted record.`,
      { retryInput: input },
    )
  }

  return stripQuoteCacheState(cacheRecord)
}

function findQuoteByRef(quotes: QuoteCacheRecord[], ref: string | undefined): QuoteCacheRecord | undefined {
  if (!ref) return undefined
  return quotes.find((quote) => quote.id === ref || quote.uri === ref || quote.rkey === ref)
}

function matchesQuote(quote: QuoteCacheRecord, target: NormalizedQuoteRecord | undefined): boolean {
  if (!target) return false
  return quote.id === target.id || quote.uri === target.uri || quote.rkey === target.rkey
}

function toQuoteCacheRecord(record: QuoteCacheRecord | NormalizedQuoteRecord): QuoteCacheRecord {
  return record as QuoteCacheRecord
}

function toIdleQuoteCacheRecord(record: NormalizedQuoteRecord): QuoteCacheRecord {
  return {
    ...record,
    status: 'idle',
    errorMessage: undefined,
    retryLabel: undefined,
    failedMutation: undefined,
    isTemporary: undefined,
  }
}

function toIdleCanvasSettingsCacheRecord(record: NormalizedCanvasSettingsRecord): CanvasSettingsCacheRecord {
  return {
    ...record,
    status: 'idle',
    errorMessage: undefined,
    failedMutation: undefined,
    isTemporary: undefined,
  }
}

function stripQuoteCacheState(record: QuoteCacheRecord): NormalizedQuoteRecord {
  const {
    status: _status,
    errorMessage: _errorMessage,
    retryLabel: _retryLabel,
    isTemporary: _isTemporary,
    failedMutation: _failedMutation,
    ...persisted
  } = record
  return persisted
}

function persistedSettingsOrNull(
  record: CanvasSettingsCacheRecord | NormalizedCanvasSettingsRecord | null | undefined,
): NormalizedCanvasSettingsRecord | null {
  if (!record) return null
  const cacheRecord = record as CanvasSettingsCacheRecord
  if (cacheRecord.isTemporary) return null

  const {
    status: _status,
    errorMessage: _errorMessage,
    isTemporary: _isTemporary,
    failedMutation: _failedMutation,
    ...persisted
  } = cacheRecord
  return persisted
}

function replaceOptimisticQuote(quotes: QuoteCacheRecord[], optimisticId: string | undefined, created: QuoteCacheRecord): QuoteCacheRecord[] {
  if (!optimisticId) return sortQuotes([...quotes, created])

  let replaced = false
  const next = quotes.map((quote) => {
    if (quote.id !== optimisticId) return quote
    replaced = true
    return created
  })

  return sortQuotes(replaced ? next : [...next, created])
}

function replacePersistedQuote(
  quotes: QuoteCacheRecord[],
  previousTarget: NormalizedQuoteRecord | undefined,
  updated: QuoteCacheRecord,
): QuoteCacheRecord[] {
  let replaced = false
  const next = quotes.map((quote) => {
    if (!matchesQuote(quote, previousTarget) && !matchesQuote(quote, updated)) return quote
    replaced = true
    return updated
  })

  return sortQuotes(replaced ? next : [...next, updated])
}

function markQuoteFailure<TInput>(
  previousQuotes: QuoteCacheRecord[],
  target: NormalizedQuoteRecord | undefined,
  action: QuoteMutationAction,
  input: TInput,
  error: QuoteQueryError<TInput>,
): QuoteCacheRecord[] {
  const failure = mutationFailure(action, input, error)
  const retryLabel = error.isConflict ? 'Apply local change to latest version' : 'Retry'
  const latest = error.latestQuote ? toIdleQuoteCacheRecord(error.latestQuote) : undefined
  const targetForFailure = latest ?? target
  const baseQuotes = latest ? upsertQuoteForFailure(previousQuotes, target, latest) : previousQuotes
  const withFailure = baseQuotes.map((quote) =>
    matchesQuote(quote, targetForFailure)
      ? {
          ...quote,
          status: 'error' as StickyNoteStatus,
          errorMessage: error.message,
          retryLabel,
          failedMutation: failure,
        }
      : quote,
  )

  if (targetForFailure && !withFailure.some((quote) => matchesQuote(quote, targetForFailure))) {
    withFailure.push({ ...targetForFailure, status: 'error', errorMessage: error.message, retryLabel, failedMutation: failure })
  }

  return sortQuotes(withFailure)
}

function upsertQuoteForFailure(
  quotes: QuoteCacheRecord[],
  previousTarget: NormalizedQuoteRecord | undefined,
  latest: QuoteCacheRecord,
): QuoteCacheRecord[] {
  let replaced = false
  const next = quotes.map((quote) => {
    if (!matchesQuote(quote, previousTarget) && !matchesQuote(quote, latest)) return quote
    replaced = true
    return latest
  })

  return replaced ? next : [...next, latest]
}

function markSettingsFailure<TInput>(
  previousSettings: CanvasSettingsCacheRecord | null | undefined,
  input: TInput,
  error: QuoteQueryError<TInput>,
): CanvasSettingsCacheRecord | null {
  if (!previousSettings) return null

  return {
    ...previousSettings,
    status: 'error',
    errorMessage: error.message,
    failedMutation: mutationFailure('settings', input, error),
  }
}

function mutationFailure<TInput>(
  action: QuoteMutationAction,
  input: TInput,
  error: QuoteQueryError<TInput>,
): QuoteMutationFailure<TInput> {
  return {
    action,
    input,
    message: error.message,
    isConflict: error.isConflict || undefined,
    failedAt: new Date().toISOString(),
  }
}

function isRecordConflict(error: unknown): boolean {
  return isStaleRecordCidError(error) || isAtprotoRecordConflictError(error)
}

function canAutoMergePositionOnlyConflict(
  updates: QuoteUpdateInput,
  previous: NormalizedQuoteRecord,
  latest: NormalizedQuoteRecord,
): boolean {
  return isPositionOnlyUpdate(updates) && !positionChanged(previous, latest)
}

function isPositionOnlyUpdate(updates: QuoteUpdateInput): boolean {
  const keys = Object.keys(updates)
  return keys.length === 1 && keys[0] === 'position' && Boolean(updates.position)
}

function positionChanged(previous: NormalizedQuoteRecord, latest: NormalizedQuoteRecord): boolean {
  return previous.position.x !== latest.position.x || previous.position.y !== latest.position.y
}

async function refetchQuoteAfterConflict(
  repo: string,
  target: NormalizedQuoteRecord,
  action: string,
  originalError: unknown,
): Promise<NormalizedQuoteRecord> {
  try {
    return await getQuoteRecord({ repo, rkey: target.rkey })
  } catch (refetchError) {
    throw new QuoteQueryError(
      action,
      `Could not ${action}. What went wrong: the PDS rejected the write because the cached CID is stale, and the latest record could not be refetched: ${errorMessage(refetchError)} What to do: refresh the canvas, confirm the note still exists, then retry the local change manually.`,
      { did: repo, cause: originalError, isConflict: true },
    )
  }
}

function toQuoteConflictError<TInput>(
  action: string,
  cause: unknown,
  options: { did?: string; retryInput?: TInput; latestQuote: NormalizedQuoteRecord; detail: string },
): QuoteQueryError<TInput> {
  return new QuoteQueryError(
    action,
    `Could not ${action}. What went wrong: ${options.detail} Why it happened: the cached CID is stale because the record changed on the PDS before this write. What to do: review the refreshed note, then use the retry action only if applying your local change to the latest version is still correct.`,
    {
      did: options.did,
      cause,
      retryInput: options.retryInput,
      isConflict: true,
      latestQuote: options.latestQuote,
    },
  )
}

function sortQuotes<TQuote extends QuoteCacheRecord>(quotes: TQuote[]): TQuote[] {
  return [...quotes].sort((left, right) => {
    const zIndexDiff = (left.zIndex ?? 0) - (right.zIndex ?? 0)
    if (zIndexDiff !== 0) return zIndexDiff

    const createdAtDiff = Date.parse(left.createdAt) - Date.parse(right.createdAt)
    if (createdAtDiff !== 0) return createdAtDiff

    return left.uri.localeCompare(right.uri)
  })
}

function temporaryRecordId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  return `temp:${prefix}:${random}`
}

function toQuoteQueryError<TInput>(
  action: string,
  cause: unknown,
  options: { did?: string; retryInput?: TInput } = {},
): QuoteQueryError<TInput> {
  if (cause instanceof QuoteQueryError) return cause as QuoteQueryError<TInput>

  const isConflict = isRecordConflict(cause)
  const nextStep = isConflict
    ? 'refresh the account-scoped data, review the latest PDS record, then retry only if applying the local change to that latest version is still correct.'
    : 'refresh the account-scoped data, keep the local change available for retry, and try again when the PDS/session is healthy.'

  return new QuoteQueryError(
    action,
    `Could not ${action}. What went wrong: ${errorMessage(cause)} What to do: ${nextStep}`,
    { did: options.did, cause, retryInput: options.retryInput, isConflict },
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}
