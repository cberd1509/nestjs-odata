/**
 * Malformed-input and limit handling of the $batch multipart parser.
 */
import { describe, it, expect } from 'vitest'
import { MAX_BATCH_OPERATIONS, parseBatchBody } from './batch-parser.js'
import { ODataValidationError } from '../query/odata-validation.error.js'

const B = 'batch_x'
const CS = 'changeset_y'

const getPart = (url = '/odata/Products'): string =>
  ['Content-Type: application/http', '', `GET ${url} HTTP/1.1`, ''].join('\n')

describe('parseBatchBody() framing', () => {
  it('ignores a preamble before the first boundary', () => {
    const body = ['This is a preamble', `--${B}`, getPart(), `--${B}--`].join('\n')
    const parsed = parseBatchBody(body, B)
    expect(parsed.parts).toHaveLength(1)
    expect(parsed.parts[0]).toMatchObject({ kind: 'request', method: 'GET' })
  })

  it('skips empty parts between boundaries', () => {
    const body = [`--${B}`, '', `--${B}`, getPart(), `--${B}`, `--${B}--`].join('\n')
    expect(parseBatchBody(body, B).parts).toHaveLength(1)
  })

  it('parses the last part when the closing boundary is missing', () => {
    const body = [`--${B}`, getPart('/odata/A'), `--${B}`, getPart('/odata/B')].join('\n')
    const parsed = parseBatchBody(body, B)
    expect(parsed.parts.map((p) => (p.kind === 'request' ? p.url : null))).toEqual([
      '/odata/A',
      '/odata/B',
    ])
  })

  it('returns no parts for a body with only the closing boundary', () => {
    expect(parseBatchBody(`--${B}\n--${B}--`, B).parts).toEqual([])
  })

  it('ignores whitespace-only and colon-less MIME header lines', () => {
    const part = [
      'Content-Type: application/http',
      '   ',
      'garbage-without-colon',
      '',
      'GET /odata/Products HTTP/1.1',
    ].join('\n')
    const parsed = parseBatchBody([`--${B}`, part, `--${B}--`].join('\n'), B)
    expect(parsed.parts[0]).toMatchObject({ kind: 'request', url: '/odata/Products' })
  })

  it('ignores colon-less header lines of the embedded request', () => {
    const part = [
      'Content-Type: application/http',
      '',
      'GET /odata/Products HTTP/1.1',
      'not a header',
      'Accept: application/json',
    ].join('\n')
    const parsed = parseBatchBody([`--${B}`, part, `--${B}--`].join('\n'), B)
    expect(parsed.parts[0]).toMatchObject({ headers: { accept: 'application/json' } })
  })
})

describe('parseBatchBody() validation', () => {
  it(`rejects more than ${MAX_BATCH_OPERATIONS} operations`, () => {
    const lines: string[] = []
    for (let i = 0; i <= MAX_BATCH_OPERATIONS; i++) lines.push(`--${B}`, getPart())
    lines.push(`--${B}--`)
    expect(() => parseBatchBody(lines.join('\n'), B)).toThrow(
      `Batch request exceeds maximum of ${MAX_BATCH_OPERATIONS} operations`,
    )
  })

  it(`accepts exactly ${MAX_BATCH_OPERATIONS} operations`, () => {
    const lines: string[] = []
    for (let i = 0; i < MAX_BATCH_OPERATIONS; i++) lines.push(`--${B}`, getPart())
    lines.push(`--${B}--`)
    expect(parseBatchBody(lines.join('\n'), B).parts).toHaveLength(MAX_BATCH_OPERATIONS)
  })

  it('counts changeset operations towards the limit', () => {
    const sub: string[] = []
    for (let i = 0; i <= MAX_BATCH_OPERATIONS; i++) {
      sub.push(
        `--${CS}`,
        'Content-Type: application/http',
        `Content-ID: ${i + 1}`,
        '',
        'POST /odata/Products HTTP/1.1',
        '',
        '{}',
      )
    }
    sub.push(`--${CS}--`)
    const body = [
      `--${B}`,
      `Content-Type: multipart/mixed; boundary=${CS}`,
      '',
      ...sub,
      `--${B}--`,
    ].join('\n')
    expect(() => parseBatchBody(body, B)).toThrow(ODataValidationError)
  })

  it('rejects a request line without a URL', () => {
    const part = ['Content-Type: application/http', '', 'GET'].join('\n')
    expect(() => parseBatchBody([`--${B}`, part, `--${B}--`].join('\n'), B)).toThrow(
      "Malformed batch sub-request line: 'GET'",
    )
  })

  it('rejects a changeset sub-part without a header/body separator', () => {
    const body = [
      `--${B}`,
      `Content-Type: multipart/mixed; boundary=${CS}`,
      '',
      `--${CS}`,
      'Content-Type: application/http',
      `--${CS}--`,
      `--${B}--`,
    ].join('\n')
    expect(() => parseBatchBody(body, B)).toThrow(
      'Malformed changeset sub-part: missing blank line separator',
    )
  })

  it('skips empty changeset sub-parts', () => {
    const body = [
      `--${B}`,
      `Content-Type: multipart/mixed; boundary=${CS}`,
      '',
      `--${CS}`,
      '',
      `--${CS}`,
      'Content-Type: application/http',
      'Content-ID: 1',
      '',
      'DELETE /odata/Products(1) HTTP/1.1',
      `--${CS}--`,
      `--${B}--`,
    ].join('\n')
    const parsed = parseBatchBody(body, B)
    expect(parsed.parts[0]).toMatchObject({
      kind: 'changeset',
      parts: [{ method: 'DELETE', contentId: '1' }],
    })
  })

  it('rejects a non-numeric Content-ID', () => {
    const part = [
      'Content-Type: application/http',
      'Content-ID: <abc.*>',
      '',
      'GET /odata/Products HTTP/1.1',
    ].join('\n')
    expect(() => parseBatchBody([`--${B}`, part, `--${B}--`].join('\n'), B)).toThrow(
      "Invalid Content-ID 'abc.*': must be a positive integer per OData v4 spec",
    )
  })

  it('strips angle brackets from a numeric Content-ID', () => {
    const part = [
      'Content-Type: application/http',
      'Content-ID: <7>',
      '',
      'GET /odata/Products HTTP/1.1',
    ].join('\n')
    const parsed = parseBatchBody([`--${B}`, part, `--${B}--`].join('\n'), B)
    expect(parsed.parts[0]).toMatchObject({ contentId: '7' })
  })
})
