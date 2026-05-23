import { z, type ZodError, type ZodIssue } from 'zod'

import {
  CANVAS_POSITION_LIMITS,
  CANVAS_ZOOM_X1000_LIMITS,
  NOTE_ROTATION_DEG_X100_LIMITS,
  NOTE_SIZE_LIMITS,
  QUOTE_COLOR_VALUES,
  QUOTE_FIELD_LIMITS,
} from '../config'
import { QUOTE_COLLECTION_NSID, SETTINGS_COLLECTION_NSID, SETTINGS_RECORD_KEY } from './nsids'
import type {
  CanvasSettingsRecordOutput,
  NormalizedCanvasSettingsRecord,
  NormalizedQuoteRecord,
  QuoteRecordOutput,
  RemoteAtprotoRecord,
} from '../../features/quotes/quoteTypes'

/** Allowed stacking order range for sticky notes that overlap on the canvas. */
export const QUOTE_Z_INDEX_LIMITS = {
  min: 0,
  max: 1_000_000,
} as const

/** Human-readable description of one validation failure. */
export type RecordValidationFailure = {
  /** Dot-separated field path such as `position.x`, or `<record>` for root errors. */
  field: string
  /** What was invalid about the field value. */
  problem: string
  /** Concrete remediation for callers or users before retrying the read/write. */
  fix: string
}

/** Parsed pieces of a valid AT Protocol record URI. */
export type ParsedAtUri = {
  /** Original AT URI string. */
  uri: string
  /** Repository authority segment, usually a DID. */
  repo: string
  /** Collection NSID segment. */
  collection: string
  /** Record key segment. */
  rkey: string
}

/** Error thrown when a quote or settings record fails local validation. */
export class AtprotoRecordValidationError extends Error {
  /** Validation subject used in the formatted message, for example `quote record`. */
  readonly subject: string
  /** Structured failures with field, problem, and fix text. */
  readonly failures: readonly RecordValidationFailure[]

  constructor(subject: string, failures: readonly RecordValidationFailure[]) {
    super(formatRecordValidationFailures(subject, failures))
    this.name = 'AtprotoRecordValidationError'
    this.subject = subject
    this.failures = failures
  }
}

/** Zod schema for fixed-palette sticky note colors accepted by the lexicons. */
export const quoteColorSchema = z.enum(QUOTE_COLOR_VALUES)

/** Zod schema for integer canvas world coordinates. */
export const canvasPositionSchema = z
  .object({
    x: integerInRangeSchema('position.x', CANVAS_POSITION_LIMITS.min, CANVAS_POSITION_LIMITS.max),
    y: integerInRangeSchema('position.y', CANVAS_POSITION_LIMITS.min, CANVAS_POSITION_LIMITS.max),
  })
  .strict()

/** Zod schema for optional sticky note dimensions reserved for resizing support. */
export const stickyNoteSizeSchema = z
  .object({
    width: integerInRangeSchema('size.width', NOTE_SIZE_LIMITS.minWidth, NOTE_SIZE_LIMITS.maxWidth),
    height: integerInRangeSchema('size.height', NOTE_SIZE_LIMITS.minHeight, NOTE_SIZE_LIMITS.maxHeight),
  })
  .strict()

/** Zod schema for the persisted fixed-point viewport stored in settings. */
export const canvasViewportRecordSchema = z
  .object({
    x: integerInRangeSchema('lastViewport.x', CANVAS_POSITION_LIMITS.min, CANVAS_POSITION_LIMITS.max),
    y: integerInRangeSchema('lastViewport.y', CANVAS_POSITION_LIMITS.min, CANVAS_POSITION_LIMITS.max),
    zoomX1000: integerInRangeSchema('lastViewport.zoomX1000', CANVAS_ZOOM_X1000_LIMITS.min, CANVAS_ZOOM_X1000_LIMITS.max),
  })
  .strict()

/** Zod schema for optional absolute source URIs on quote records. */
export const absoluteUriSchema = z
  .string()
  .max(QUOTE_FIELD_LIMITS.sourceUriMaxLength, `sourceUri is too long. Use no more than ${QUOTE_FIELD_LIMITS.sourceUriMaxLength} characters.`)
  .refine(isAbsoluteUri, 'sourceUri must be an absolute URI such as https://example.com/source.')

/** Zod schema for `com.kzoeps.stickyquotes.canvas.quote` record values. */
export const quoteRecordSchema = z
  .object({
    $type: z.literal(QUOTE_COLLECTION_NSID),
    schemaVersion: z.literal(1),
    text: graphemeStringSchema('text', 1, QUOTE_FIELD_LIMITS.textMaxGraphemes),
    author: graphemeStringSchema('author', 0, QUOTE_FIELD_LIMITS.authorMaxGraphemes).optional(),
    sourceTitle: graphemeStringSchema('sourceTitle', 0, QUOTE_FIELD_LIMITS.sourceTitleMaxGraphemes).optional(),
    sourceUri: absoluteUriSchema.optional(),
    position: canvasPositionSchema,
    size: stickyNoteSizeSchema.optional(),
    rotationDegX100: integerInRangeSchema(
      'rotationDegX100',
      NOTE_ROTATION_DEG_X100_LIMITS.min,
      NOTE_ROTATION_DEG_X100_LIMITS.max,
    ),
    color: quoteColorSchema,
    zIndex: integerInRangeSchema('zIndex', QUOTE_Z_INDEX_LIMITS.min, QUOTE_Z_INDEX_LIMITS.max).optional(),
    createdAt: datetimeStringSchema('createdAt'),
    updatedAt: datetimeStringSchema('updatedAt'),
  })
  .strict()

/** Zod schema for `com.kzoeps.stickyquotes.canvas.settings` record values. */
export const canvasSettingsRecordSchema = z
  .object({
    $type: z.literal(SETTINGS_COLLECTION_NSID),
    schemaVersion: z.literal(1),
    defaultColor: quoteColorSchema.optional(),
    lastViewport: canvasViewportRecordSchema.optional(),
    updatedAt: datetimeStringSchema('updatedAt'),
  })
  .strict()

/**
 * Validates an unknown value as a quote record read from or written to a PDS.
 * Throws `AtprotoRecordValidationError` with field-specific fixes when invalid.
 */
export function validateQuoteRecord(value: unknown): QuoteRecordOutput {
  const parsed = quoteRecordSchema.safeParse(value)
  if (!parsed.success) {
    throw validationErrorFromZodError('quote record', parsed.error)
  }

  return parsed.data
}

/**
 * Validates an unknown value as a canvas settings record read from or written to a PDS.
 * Throws `AtprotoRecordValidationError` with field-specific fixes when invalid.
 */
export function validateCanvasSettingsRecord(value: unknown): CanvasSettingsRecordOutput {
  const parsed = canvasSettingsRecordSchema.safeParse(value)
  if (!parsed.success) {
    throw validationErrorFromZodError('canvas settings record', parsed.error)
  }

  return parsed.data
}

/** Returns true when a value is a valid sticky quote record. */
export function isQuoteRecord(value: unknown): value is QuoteRecordOutput {
  return quoteRecordSchema.safeParse(value).success
}

/** Returns true when a value is a valid canvas settings record. */
export function isCanvasSettingsRecord(value: unknown): value is CanvasSettingsRecordOutput {
  return canvasSettingsRecordSchema.safeParse(value).success
}

/**
 * Normalizes an untrusted remote quote record by validating its value and parsing URI metadata.
 * The returned object includes `uri`, `cid`, `rkey`, a UI `id`, and all typed quote fields.
 */
export function normalizeQuoteRecord(remoteRecord: RemoteAtprotoRecord): NormalizedQuoteRecord {
  const uri = requireNonEmptyMetadata(remoteRecord.uri, 'uri', 'quote record')
  const cid = requireNonEmptyMetadata(remoteRecord.cid, 'cid', 'quote record')
  const parsedUri = parseAtUri(uri, QUOTE_COLLECTION_NSID)
  const record = validateQuoteRecord(remoteRecord.value)

  return {
    ...record,
    uri,
    cid,
    rkey: parsedUri.rkey,
    id: uri,
  }
}

/**
 * Normalizes an untrusted remote settings record by validating its value and singleton `self` rkey.
 * The returned object includes `uri`, `cid`, `rkey`, and all typed settings fields.
 */
export function normalizeCanvasSettingsRecord(remoteRecord: RemoteAtprotoRecord): NormalizedCanvasSettingsRecord {
  const uri = requireNonEmptyMetadata(remoteRecord.uri, 'uri', 'canvas settings record')
  const cid = requireNonEmptyMetadata(remoteRecord.cid, 'cid', 'canvas settings record')
  const parsedUri = parseAtUri(uri, SETTINGS_COLLECTION_NSID)
  if (parsedUri.rkey !== SETTINGS_RECORD_KEY) {
    throw new Error(
      `Invalid canvas settings record URI. What went wrong: expected rkey "${SETTINGS_RECORD_KEY}" but received "${parsedUri.rkey}". Why it matters: settings are a singleton record and other rkeys would create conflicting preferences. What to do: read or write the settings record using rkey "${SETTINGS_RECORD_KEY}".`,
    )
  }

  const record = validateCanvasSettingsRecord(remoteRecord.value)

  return {
    ...record,
    uri,
    cid,
    rkey: parsedUri.rkey,
  }
}

/**
 * Parses an AT Protocol record URI into repo, collection, and rkey parts.
 * Pass `expectedCollection` to reject records from the wrong collection before validation.
 */
export function parseAtUri(uri: string, expectedCollection?: string): ParsedAtUri {
  const match = /^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)$/.exec(uri)
  if (!match) {
    throw new Error(
      `Invalid AT URI. What went wrong: "${uri}" is not shaped like at://repo/collection/rkey. Why it matters: the app needs the collection and rkey to update or delete the record safely. What to do: pass the full AT URI returned by com.atproto.repo.createRecord or listRecords.`,
    )
  }

  const [, repo, collection, rkey] = match
  if (!repo || !collection || !rkey) {
    throw new Error(
      `Invalid AT URI. What went wrong: "${uri}" is missing a repo, collection, or record key. Why it matters: records cannot be normalized without all three parts. What to do: use an AT URI in the form at://repo/collection/rkey.`,
    )
  }

  if (expectedCollection && collection !== expectedCollection) {
    throw new Error(
      `Invalid AT URI collection. What went wrong: expected collection "${expectedCollection}" but received "${collection}". Why it matters: using the wrong collection would validate or update the wrong record type. What to do: list records from "${expectedCollection}" and retry with that URI.`,
    )
  }

  return { uri, repo, collection, rkey }
}

/** Extracts the record key from an AT URI and optionally verifies the collection NSID. */
export function parseRecordKeyFromAtUri(uri: string, expectedCollection?: string): string {
  return parseAtUri(uri, expectedCollection).rkey
}

/** Formats a Zod validation error with actionable field-level guidance. */
export function formatZodValidationError(subject: string, error: ZodError): string {
  return formatRecordValidationFailures(subject, zodIssuesToFailures(error.issues))
}

/** Formats any validation failure into the app's what/why/fix error style. */
export function formatValidationError(error: unknown, fallbackSubject = 'record'): string {
  if (error instanceof AtprotoRecordValidationError) return error.message
  if (error instanceof z.ZodError) return formatZodValidationError(fallbackSubject, error)
  if (error instanceof Error && error.message) return error.message
  return `Invalid ${fallbackSubject}. What went wrong: ${String(error)}. Why it matters: invalid records cannot be safely read from or written to the PDS. What to do: validate the record fields and retry.`
}

/** Converts Zod issues into structured field, problem, and fix descriptions. */
export function zodIssuesToFailures(issues: readonly ZodIssue[]): RecordValidationFailure[] {
  return issues.map((issue) => {
    const field = issuePathToField(issue.path)
    return {
      field,
      problem: issue.message,
      fix: fixForField(field),
    }
  })
}

/** Formats structured failures into a single actionable error message. */
export function formatRecordValidationFailures(subject: string, failures: readonly RecordValidationFailure[]): string {
  if (!failures.length) {
    return `Invalid ${subject}. What went wrong: validation failed without a field-level reason. Why it matters: invalid records cannot be safely read from or written to the PDS. What to do: compare the record against the ${subject} lexicon and retry.`
  }

  const details = failures
    .map((failure) => `${failure.field}: ${failure.problem} What to do: ${failure.fix}`)
    .join(' ')

  return `Invalid ${subject}. What went wrong: ${details} Why it matters: ${subject} data must match the local lexicon before the app reads from or writes to a user's public PDS.`
}

function validationErrorFromZodError(subject: string, error: ZodError): AtprotoRecordValidationError {
  return new AtprotoRecordValidationError(subject, zodIssuesToFailures(error.issues))
}

function integerInRangeSchema(field: string, min: number, max: number) {
  return z
    .number()
    .int(`${field} must be an integer because PDS records store deterministic fixed-point/canvas values.`)
    .min(min, `${field} is too small. Use a value greater than or equal to ${min}.`)
    .max(max, `${field} is too large. Use a value less than or equal to ${max}.`)
}

function graphemeStringSchema(field: string, minGraphemes: number, maxGraphemes: number) {
  return z.string().superRefine((value, context) => {
    const count = countGraphemes(value)
    if (count < minGraphemes) {
      context.addIssue({
        code: 'custom',
        message: `${field} has ${count} grapheme${count === 1 ? '' : 's'}. Use at least ${minGraphemes}.`,
      })
    }
    if (count > maxGraphemes) {
      context.addIssue({
        code: 'custom',
        message: `${field} has ${count} graphemes. Use no more than ${maxGraphemes}.`,
      })
    }
  })
}

function datetimeStringSchema(field: string) {
  return z.string().refine(isIsoDateTimeString, `${field} must be an ISO/RFC3339 datetime string such as 2026-05-21T10:00:00.000Z.`)
}

function isAbsoluteUri(value: string): boolean {
  try {
    const url = new URL(value)
    return Boolean(url.protocol && url.protocol.length > 1)
  } catch {
    return false
  }
}

function isIsoDateTimeString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false
  }

  return !Number.isNaN(new Date(value).getTime())
}

function requireNonEmptyMetadata(value: string, field: 'uri' | 'cid', subject: string): string {
  if (typeof value === 'string' && value.trim()) return value

  throw new Error(
    `Invalid ${subject} metadata. What went wrong: ${field} is missing or empty. Why it matters: ${field} is required to reconcile PDS reads and writes safely. What to do: pass the complete record metadata returned by com.atproto.repo list/get/create/put calls.`,
  )
}

type IntlWithSegmenter = typeof Intl & {
  Segmenter?: new (
    locales?: string | string[],
    options?: { granularity?: 'grapheme' | 'word' | 'sentence' },
  ) => { segment(input: string): Iterable<unknown> }
}

function countGraphemes(value: string): number {
  const Segmenter = (Intl as IntlWithSegmenter).Segmenter
  if (Segmenter) {
    return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(value)).length
  }

  return Array.from(value).length
}

function issuePathToField(path: readonly (string | number | symbol)[]): string {
  if (!path.length) return '<record>'
  return path.map((part) => String(part)).join('.')
}

function fixForField(field: string): string {
  const fixes: Record<string, string> = {
    '<record>': 'Provide a plain object that matches the expected quote or settings record shape.',
    '$type': `Use the exact collection NSID discriminator: "${QUOTE_COLLECTION_NSID}" for quotes or "${SETTINGS_COLLECTION_NSID}" for settings.`,
    schemaVersion: 'Use schemaVersion: 1 until a documented migration introduces a new version.',
    text: `Provide plain quote text between 1 and ${QUOTE_FIELD_LIMITS.textMaxGraphemes} graphemes; do not store HTML.`,
    author: `Omit author or keep it at ${QUOTE_FIELD_LIMITS.authorMaxGraphemes} graphemes or fewer.`,
    sourceTitle: `Omit sourceTitle or keep it at ${QUOTE_FIELD_LIMITS.sourceTitleMaxGraphemes} graphemes or fewer.`,
    sourceUri: `Omit sourceUri or provide an absolute URI no longer than ${QUOTE_FIELD_LIMITS.sourceUriMaxLength} characters.`,
    position: 'Provide both integer position.x and position.y canvas world coordinates.',
    'position.x': `Use an integer x coordinate between ${CANVAS_POSITION_LIMITS.min} and ${CANVAS_POSITION_LIMITS.max}.`,
    'position.y': `Use an integer y coordinate between ${CANVAS_POSITION_LIMITS.min} and ${CANVAS_POSITION_LIMITS.max}.`,
    size: 'Omit size or provide both integer width and height within the note size limits.',
    'size.width': `Use an integer width between ${NOTE_SIZE_LIMITS.minWidth} and ${NOTE_SIZE_LIMITS.maxWidth}.`,
    'size.height': `Use an integer height between ${NOTE_SIZE_LIMITS.minHeight} and ${NOTE_SIZE_LIMITS.maxHeight}.`,
    rotationDegX100: `Use an integer fixed-point rotation between ${NOTE_ROTATION_DEG_X100_LIMITS.min} and ${NOTE_ROTATION_DEG_X100_LIMITS.max}.`,
    color: `Use one of the fixed palette values: ${QUOTE_COLOR_VALUES.join(', ')}.`,
    zIndex: `Omit zIndex or use an integer between ${QUOTE_Z_INDEX_LIMITS.min} and ${QUOTE_Z_INDEX_LIMITS.max}.`,
    createdAt: 'Use an ISO/RFC3339 datetime string, for example new Date().toISOString().',
    updatedAt: 'Use an ISO/RFC3339 datetime string, for example new Date().toISOString().',
    defaultColor: `Omit defaultColor or use one of: ${QUOTE_COLOR_VALUES.join(', ')}.`,
    lastViewport: 'Omit lastViewport or provide integer x, y, and zoomX1000 fields.',
    'lastViewport.x': `Use an integer viewport center x between ${CANVAS_POSITION_LIMITS.min} and ${CANVAS_POSITION_LIMITS.max}.`,
    'lastViewport.y': `Use an integer viewport center y between ${CANVAS_POSITION_LIMITS.min} and ${CANVAS_POSITION_LIMITS.max}.`,
    'lastViewport.zoomX1000': `Use an integer zoom between ${CANVAS_ZOOM_X1000_LIMITS.min} and ${CANVAS_ZOOM_X1000_LIMITS.max}, where 1000 means 1.0x.`,
  }

  return fixes[field] ?? 'Correct this field to match docs/lexicons.md, then retry the PDS read or write.'
}
