/**
 * Tests for OData v4 $batch multipart/mixed parser.
 *
 * Covers all 11 behavioral requirements from 05-01-PLAN.md Task 1.
 */
import { describe, it, expect } from 'vitest'
import { extractBoundary, parseBatchBody } from './batch-parser.js'
import { ODataValidationError } from '../query/odata-validation.error.js'

describe('extractBoundary', () => {
  it('Test 1: extracts unquoted boundary from Content-Type', () => {
    const result = extractBoundary('multipart/mixed; boundary=batch_abc123')
    expect(result).toBe('batch_abc123')
  })

  it('Test 2: extracts quoted boundary from Content-Type', () => {
    const result = extractBoundary('multipart/mixed; boundary="batch_abc"')
    expect(result).toBe('batch_abc')
  })

  it('Test 3: throws ODataValidationError when boundary is missing', () => {
    expect(() => extractBoundary('multipart/mixed')).toThrow(ODataValidationError)
    expect(() => extractBoundary('multipart/mixed')).toThrow(/boundary/i)
  })

  it('handles boundary as first parameter', () => {
    const result = extractBoundary('multipart/mixed; boundary=abc; charset=utf-8')
    expect(result).toBe('abc')
  })

  it('handles boundary with dashes and underscores', () => {
    const result = extractBoundary('multipart/mixed; boundary=batch_123-abc_xyz')
    expect(result).toBe('batch_123-abc_xyz')
  })
})

describe('parseBatchBody', () => {
  const BOUNDARY = 'batch_1234'

  function buildBody(parts: string[]): string {
    const lines: string[] = []
    for (const part of parts) {
      lines.push(`--${BOUNDARY}`)
      lines.push(part)
    }
    lines.push(`--${BOUNDARY}--`)
    return lines.join('\r\n')
  }

  const GET_PART = [
    'Content-Type: application/http',
    'Content-Transfer-Encoding: binary',
    '',
    'GET /odata/Products HTTP/1.1',
    'Accept: application/json',
    '',
  ].join('\r\n')

  it('Test 4: parses single individual GET request', () => {
    const body = buildBody([GET_PART])
    const result = parseBatchBody(body, BOUNDARY)

    expect(result.parts).toHaveLength(1)
    const part = result.parts[0]
    expect(part.kind).toBe('request')
    if (part.kind === 'request') {
      expect(part.method).toBe('GET')
      expect(part.url).toBe('/odata/Products')
      expect(part.body).toBeUndefined()
      expect(part.headers).toHaveProperty('accept', 'application/json')
    }
  })

  it('Test 5: parses changeset with POST + PATCH', () => {
    const CHANGESET_BOUNDARY = 'changeset_5678'

    const changesetBody = [
      '--' + CHANGESET_BOUNDARY,
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      '',
      'POST /odata/Products HTTP/1.1',
      'Content-Type: application/json',
      '',
      '{"name":"Widget","price":9.99}',
      '--' + CHANGESET_BOUNDARY,
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      '',
      'PATCH /odata/Products(1) HTTP/1.1',
      'Content-Type: application/json',
      '',
      '{"name":"Updated Widget"}',
      '--' + CHANGESET_BOUNDARY + '--',
    ].join('\r\n')

    const changesetPart = [
      `Content-Type: multipart/mixed; boundary=${CHANGESET_BOUNDARY}`,
      '',
      changesetBody,
    ].join('\r\n')

    const body = buildBody([changesetPart])
    const result = parseBatchBody(body, BOUNDARY)

    expect(result.parts).toHaveLength(1)
    const part = result.parts[0]
    expect(part.kind).toBe('changeset')
    if (part.kind === 'changeset') {
      expect(part.parts).toHaveLength(2)
      expect(part.parts[0].kind).toBe('request')
      expect(part.parts[0].method).toBe('POST')
      expect(part.parts[0].url).toBe('/odata/Products')
      expect(part.parts[1].kind).toBe('request')
      expect(part.parts[1].method).toBe('PATCH')
      expect(part.parts[1].url).toBe('/odata/Products(1)')
    }
  })

  it('Test 6: parses mixed individual requests and changesets', () => {
    const CHANGESET_BOUNDARY = 'changeset_9999'

    const changesetBody = [
      '--' + CHANGESET_BOUNDARY,
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      '',
      'POST /odata/Categories HTTP/1.1',
      'Content-Type: application/json',
      '',
      '{"name":"Electronics"}',
      '--' + CHANGESET_BOUNDARY + '--',
    ].join('\r\n')

    const changesetPart = [
      `Content-Type: multipart/mixed; boundary=${CHANGESET_BOUNDARY}`,
      '',
      changesetBody,
    ].join('\r\n')

    const body = buildBody([GET_PART, changesetPart, GET_PART])
    const result = parseBatchBody(body, BOUNDARY)

    expect(result.parts).toHaveLength(3)
    expect(result.parts[0].kind).toBe('request')
    expect(result.parts[1].kind).toBe('changeset')
    expect(result.parts[2].kind).toBe('request')
  })

  it('Test 7: handles CRLF and LF line endings', () => {
    // LF only version of a GET request
    const bodyLF = [
      `--${BOUNDARY}`,
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      '',
      'GET /odata/Products HTTP/1.1',
      '',
      `--${BOUNDARY}--`,
    ].join('\n')

    const resultLF = parseBatchBody(bodyLF, BOUNDARY)
    expect(resultLF.parts).toHaveLength(1)
    expect(resultLF.parts[0].kind).toBe('request')

    // CRLF version
    const bodyCRLF = [
      `--${BOUNDARY}`,
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      '',
      'GET /odata/Products HTTP/1.1',
      '',
      `--${BOUNDARY}--`,
    ].join('\r\n')

    const resultCRLF = parseBatchBody(bodyCRLF, BOUNDARY)
    expect(resultCRLF.parts).toHaveLength(1)
    expect(resultCRLF.parts[0].kind).toBe('request')
  })

  it('Test 8: preserves Content-ID from changeset sub-parts', () => {
    const CHANGESET_BOUNDARY = 'changeset_cid'

    const changesetBody = [
      '--' + CHANGESET_BOUNDARY,
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      'Content-ID: 1',
      '',
      'POST /odata/Products HTTP/1.1',
      'Content-Type: application/json',
      '',
      '{"name":"Widget"}',
      '--' + CHANGESET_BOUNDARY + '--',
    ].join('\r\n')

    const changesetPart = [
      `Content-Type: multipart/mixed; boundary=${CHANGESET_BOUNDARY}`,
      '',
      changesetBody,
    ].join('\r\n')

    const body = buildBody([changesetPart])
    const result = parseBatchBody(body, BOUNDARY)

    expect(result.parts).toHaveLength(1)
    const part = result.parts[0]
    expect(part.kind).toBe('changeset')
    if (part.kind === 'changeset') {
      expect(part.parts[0].contentId).toBe('1')
    }
  })

  it('Test 9: preserves JSON body in POST requests', () => {
    const postPart = [
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      '',
      'POST /odata/Products HTTP/1.1',
      'Content-Type: application/json',
      '',
      '{"name":"Test Product","price":42.0}',
    ].join('\r\n')

    const body = buildBody([postPart])
    const result = parseBatchBody(body, BOUNDARY)

    expect(result.parts).toHaveLength(1)
    const part = result.parts[0]
    expect(part.kind).toBe('request')
    if (part.kind === 'request') {
      expect(part.body).toBe('{"name":"Test Product","price":42.0}')
    }
  })

  it('Test 10: returns empty parts array for empty body', () => {
    const result = parseBatchBody('', BOUNDARY)
    expect(result.parts).toHaveLength(0)
  })

  it('Test 11: throws ODataValidationError for malformed boundary (no terminator, bad content)', () => {
    // A body with content but no recognizable boundary structure and malformed part
    // Use a part that has no blank line separator
    const badBody = `--${BOUNDARY}\nContent-Type: application/http\n--${BOUNDARY}--`
    expect(() => parseBatchBody(badBody, BOUNDARY)).toThrow(ODataValidationError)
  })
})
