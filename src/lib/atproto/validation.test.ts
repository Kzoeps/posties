import { describe, expect, it } from 'vitest'

import { CANVAS_POSITION_LIMITS, NOTE_ROTATION_DEG_X100_LIMITS, QUOTE_FIELD_LIMITS } from '../config'
import { QUOTE_COLLECTION_NSID, SETTINGS_COLLECTION_NSID, SETTINGS_RECORD_KEY } from './nsids'
import {
  AtprotoRecordValidationError,
  normalizeCanvasSettingsRecord,
  normalizeQuoteRecord,
  parseAtUri,
  parseRecordKeyFromAtUri,
  validateCanvasSettingsRecord,
  validateQuoteRecord,
} from './validation'
import type { CanvasSettingsRecordValue, QuoteRecordValue, RemoteAtprotoRecord } from '../../features/quotes/quoteTypes'

const VALID_CREATED_AT = '2026-05-21T10:00:00.000Z'
const VALID_UPDATED_AT = '2026-05-21T10:05:00.000Z'
const VALID_QUOTE_URI = `at://did:plc:stickyquotes/${QUOTE_COLLECTION_NSID}/3lvalidquote`
const VALID_SETTINGS_URI = `at://did:plc:stickyquotes/${SETTINGS_COLLECTION_NSID}/${SETTINGS_RECORD_KEY}`

describe('quote record validation', () => {
  it('accepts a valid quote record', () => {
    const record = validQuoteRecord()

    expect(validateQuoteRecord(record)).toEqual(record)
  })

  it('rejects a missing required text field with an actionable field error', () => {
    const record = validQuoteRecord() as Partial<QuoteRecordValue>
    delete record.text

    expect(() => validateQuoteRecord(record)).toThrow(AtprotoRecordValidationError)
    expect(() => validateQuoteRecord(record)).toThrow(/text/i)
    expect(() => validateQuoteRecord(record)).toThrow(/What to do/i)
  })

  it('rejects colors outside the fixed lexicon palette', () => {
    const record = { ...validQuoteRecord(), color: 'chartreuse' }

    expect(() => validateQuoteRecord(record)).toThrow(/color/i)
    expect(() => validateQuoteRecord(record)).toThrow(/yellow, pink, blue, green, purple, orange, gray/)
  })

  it('rejects overlong quote text', () => {
    const record = {
      ...validQuoteRecord(),
      text: 'a'.repeat(QUOTE_FIELD_LIMITS.textMaxGraphemes + 1),
    }

    expect(() => validateQuoteRecord(record)).toThrow(new RegExp(`Use no more than ${QUOTE_FIELD_LIMITS.textMaxGraphemes}`))
  })

  it('rejects out-of-bounds integer positions', () => {
    const record = {
      ...validQuoteRecord(),
      position: { x: CANVAS_POSITION_LIMITS.max + 1, y: 0 },
    }

    expect(() => validateQuoteRecord(record)).toThrow(/position\.x is too large/)
  })

  it('rejects rotation values outside the fixed-point bounds', () => {
    const record = {
      ...validQuoteRecord(),
      rotationDegX100: NOTE_ROTATION_DEG_X100_LIMITS.max + 1,
    }

    expect(() => validateQuoteRecord(record)).toThrow(/rotationDegX100 is too large/)
  })

  it('rejects non-absolute source URIs', () => {
    const record = {
      ...validQuoteRecord(),
      sourceUri: '/relative/source',
    }

    expect(() => validateQuoteRecord(record)).toThrow(/sourceUri must be an absolute URI/)
  })
})

describe('settings record validation', () => {
  it('accepts a valid singleton canvas settings record', () => {
    const record = validSettingsRecord()

    expect(validateCanvasSettingsRecord(record)).toEqual(record)
  })

  it('rejects invalid default colors', () => {
    const record = { ...validSettingsRecord(), defaultColor: 'black' }

    expect(() => validateCanvasSettingsRecord(record)).toThrow(/defaultColor/i)
  })
})

describe('AT URI parsing and normalization', () => {
  it('parses repo, collection, and rkey from valid AT URIs', () => {
    expect(parseAtUri(VALID_QUOTE_URI, QUOTE_COLLECTION_NSID)).toEqual({
      uri: VALID_QUOTE_URI,
      repo: 'did:plc:stickyquotes',
      collection: QUOTE_COLLECTION_NSID,
      rkey: '3lvalidquote',
    })
    expect(parseRecordKeyFromAtUri(VALID_QUOTE_URI, QUOTE_COLLECTION_NSID)).toBe('3lvalidquote')
  })

  it('rejects malformed AT URIs before normalization', () => {
    expect(() => parseAtUri('https://example.com/not-at-uri')).toThrow(/Invalid AT URI/)
  })

  it('rejects AT URIs from the wrong collection', () => {
    expect(() => parseAtUri(VALID_QUOTE_URI, SETTINGS_COLLECTION_NSID)).toThrow(/Invalid AT URI collection/)
  })

  it('normalizes quote records with metadata and parsed rkey', () => {
    const remoteRecord: RemoteAtprotoRecord = {
      uri: VALID_QUOTE_URI,
      cid: 'bafyquote',
      value: validQuoteRecord(),
    }

    expect(normalizeQuoteRecord(remoteRecord)).toMatchObject({
      id: VALID_QUOTE_URI,
      uri: VALID_QUOTE_URI,
      cid: 'bafyquote',
      rkey: '3lvalidquote',
      text: 'Fear is the mind-killer.',
    })
  })

  it('rejects quote normalization when required metadata is missing', () => {
    const remoteRecord: RemoteAtprotoRecord = {
      uri: VALID_QUOTE_URI,
      cid: '',
      value: validQuoteRecord(),
    }

    expect(() => normalizeQuoteRecord(remoteRecord)).toThrow(/cid is missing or empty/)
  })

  it('normalizes only the singleton settings rkey', () => {
    const remoteRecord: RemoteAtprotoRecord = {
      uri: VALID_SETTINGS_URI,
      cid: 'bafysettings',
      value: validSettingsRecord(),
    }

    expect(normalizeCanvasSettingsRecord(remoteRecord)).toMatchObject({
      uri: VALID_SETTINGS_URI,
      cid: 'bafysettings',
      rkey: SETTINGS_RECORD_KEY,
      defaultColor: 'yellow',
    })
  })

  it('rejects settings records with non-self rkeys', () => {
    const remoteRecord: RemoteAtprotoRecord = {
      uri: `at://did:plc:stickyquotes/${SETTINGS_COLLECTION_NSID}/other`,
      cid: 'bafysettings',
      value: validSettingsRecord(),
    }

    expect(() => normalizeCanvasSettingsRecord(remoteRecord)).toThrow(/expected rkey "self"/)
  })
})

function validQuoteRecord(overrides: Partial<QuoteRecordValue> = {}): QuoteRecordValue {
  return {
    $type: QUOTE_COLLECTION_NSID,
    schemaVersion: 1,
    text: 'Fear is the mind-killer.',
    author: 'Frank Herbert',
    sourceTitle: 'Dune',
    sourceUri: 'https://example.com/dune',
    position: { x: 120, y: -80 },
    size: { width: 240, height: 180 },
    rotationDegX100: -325,
    color: 'yellow',
    zIndex: 2,
    createdAt: VALID_CREATED_AT,
    updatedAt: VALID_UPDATED_AT,
    ...overrides,
  }
}

function validSettingsRecord(overrides: Partial<CanvasSettingsRecordValue> = {}): CanvasSettingsRecordValue {
  return {
    $type: SETTINGS_COLLECTION_NSID,
    schemaVersion: 1,
    defaultColor: 'yellow',
    lastViewport: { x: 0, y: 0, zoomX1000: 1000 },
    updatedAt: VALID_UPDATED_AT,
    ...overrides,
  }
}
