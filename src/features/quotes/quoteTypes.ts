import { QUOTE_COLOR_VALUES } from '../../lib/config'
import { QUOTE_COLLECTION_NSID, SETTINGS_COLLECTION_NSID } from '../../lib/atproto/nsids'

/**
 * Sticky note colors supported by the quote lexicon and UI.
 * Use these tokens instead of arbitrary CSS color values so records remain portable.
 */
export const QUOTE_COLORS = QUOTE_COLOR_VALUES

/** Color token used to style sticky notes without allowing arbitrary CSS values. */
export type QuoteColor = (typeof QUOTE_COLORS)[number]

/** Current schema version written into all v1 quote and settings records. */
export type StickyQuotesSchemaVersion = 1

/** Integer canvas world coordinate for note placement and viewport restoration. */
export type CanvasPosition = {
  /** Horizontal world coordinate, independent of viewport pan and zoom. */
  x: number
  /** Vertical world coordinate, independent of viewport pan and zoom. */
  y: number
}

/** Sticky note dimensions in canvas world units. */
export type StickyNoteSize = {
  /** Note width in world units. */
  width: number
  /** Note height in world units. */
  height: number
}

/** Last viewport state stored in the singleton settings record. */
export type CanvasViewportRecord = CanvasPosition & {
  /** Fixed-point zoom multiplier where `1000` means `1.0x`. */
  zoomX1000: number
}

/**
 * AT Protocol record value for `com.kzoeps.stickyquotes.canvas.quote`.
 * This is the exact public PDS shape validated before writes and after reads.
 */
export type QuoteRecordValue = {
  /** Lexicon type discriminator for sticky quote records. */
  $type: typeof QUOTE_COLLECTION_NSID
  /** V1 record schema marker used by future migrations. */
  schemaVersion: StickyQuotesSchemaVersion
  /** Plain quote text rendered inside the sticky note. Never render this as HTML. */
  text: string
  /** Optional credited author or speaker. */
  author?: string
  /** Optional title of the book, article, talk, or other source. */
  sourceTitle?: string
  /** Optional absolute URI for the source material. */
  sourceUri?: string
  /** Top-left note position in integer canvas world coordinates. */
  position: CanvasPosition
  /** Optional note dimensions reserved for future resizing support. */
  size?: StickyNoteSize
  /** Persistent note rotation in hundredths of a degree. */
  rotationDegX100: number
  /** Fixed palette token used to style the sticky note. */
  color: QuoteColor
  /** Optional stacking order for overlapping notes. */
  zIndex?: number
  /** ISO datetime when the quote was created. */
  createdAt: string
  /** ISO datetime when the quote was last changed. */
  updatedAt: string
}

/** Record value accepted by PDS create/put calls for quote records. */
export type QuoteRecordInput = QuoteRecordValue

/** Record value returned by PDS reads for quote records after local validation. */
export type QuoteRecordOutput = QuoteRecordValue

/**
 * AT Protocol record value for `com.kzoeps.stickyquotes.canvas.settings`.
 * The record is public and should use the literal record key `self`.
 */
export type CanvasSettingsRecordValue = {
  /** Lexicon type discriminator for canvas settings records. */
  $type: typeof SETTINGS_COLLECTION_NSID
  /** V1 settings schema marker used by future migrations. */
  schemaVersion: StickyQuotesSchemaVersion
  /** Optional default color for newly created sticky notes. */
  defaultColor?: QuoteColor
  /** Optional last viewport center and fixed-point zoom. */
  lastViewport?: CanvasViewportRecord
  /** ISO datetime when the settings record was last changed. */
  updatedAt: string
}

/** Record value accepted by PDS create/put calls for canvas settings. */
export type CanvasSettingsRecordInput = CanvasSettingsRecordValue

/** Record value returned by PDS reads for canvas settings after local validation. */
export type CanvasSettingsRecordOutput = CanvasSettingsRecordValue

/** Metadata attached by AT Protocol repository APIs to each record value. */
export type AtprotoRecordMetadata = {
  /** Full AT URI returned by the PDS, for example `at://did:plc:abc/com.example.collection/rkey`. */
  uri: string
  /** Content identifier returned by the PDS for compare-and-swap updates. */
  cid: string
  /** Parsed record key from the final path segment of the AT URI. */
  rkey: string
}

/** Raw remote record shape returned by AT Protocol list/get record calls. */
export type RemoteAtprotoRecord<TValue = unknown> = {
  /** Full AT URI identifying the record. */
  uri: string
  /** Content identifier for the record value. */
  cid: string
  /** Untrusted record value that must be validated before use. */
  value: TValue
}

/** Validated quote record with AT URI, CID, parsed rkey, and UI-friendly id. */
export type NormalizedQuoteRecord = AtprotoRecordMetadata &
  QuoteRecordOutput & {
    /** Stable identifier used by React components; currently the full AT URI. */
    id: string
  }

/** Validated canvas settings record with AT URI, CID, and parsed rkey. */
export type NormalizedCanvasSettingsRecord = AtprotoRecordMetadata & CanvasSettingsRecordOutput

/** Persistence state shown on a sticky note while PDS mutations are pending or failed. */
export type StickyNoteStatus = 'idle' | 'saving' | 'error' | 'deleting'

/** Editable quote fields shared by create and edit UI before PDS metadata is attached. */
export type QuoteEditableFields = Pick<QuoteRecordValue, 'text' | 'author' | 'sourceTitle' | 'sourceUri' | 'color'>

/** Fields needed to create a quote before server metadata such as URI and CID exists. */
export type QuoteCreateInput = QuoteEditableFields & {
  /** Initial top-left note position in integer canvas world coordinates. */
  position: CanvasPosition
  /** Optional dimensions for future resizing support. */
  size?: StickyNoteSize
  /** Optional stacking order for the new note. */
  zIndex?: number
}

/** Fields callers may change when editing a persisted quote record. */
export type QuoteUpdateInput = Partial<QuoteEditableFields> & {
  /** New top-left note position when moving a sticky note. */
  position?: CanvasPosition
  /** New dimensions when future resizing support is enabled. */
  size?: StickyNoteSize
  /** New stacking order when bringing a note forward or backward. */
  zIndex?: number
}

/** Minimal view model needed to render a quote as a sticky note on the canvas. */
export type StickyNoteViewModel = QuoteEditableFields & {
  /** Stable UI identifier, normally the AT URI for persisted notes. */
  id: string
  /** Persistent note rotation in hundredths of a degree. */
  rotationDegX100: number
  /** Optional persistence state shown by the note component. */
  status?: StickyNoteStatus
  /** Optional user-facing error message for failed mutations. */
  errorMessage?: string
  /** Optional label for retry buttons when the failure needs conflict-specific wording. */
  retryLabel?: string
}
