/**
 * Tests for OData $batch response builder.
 */
import { describe, it, expect } from 'vitest'
import { buildBatchResponse } from './batch-response-builder.js'
import type { BatchResponsePart } from '@nestjs-odata/core'

describe('buildBatchResponse', () => {
  it('Test 1: returns valid multipart/mixed string with boundary markers for 2 successful parts', () => {
    const parts: BatchResponsePart[] = [
      {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ id: 1, name: 'Widget' }),
      },
      {
        statusCode: 204,
        headers: {},
        body: undefined,
      },
    ]

    const result = buildBatchResponse(parts)

    // Content-Type should be multipart/mixed with a boundary
    expect(result.contentType).toMatch(/^multipart\/mixed; boundary=batch_/)

    // Body should contain boundary markers
    const boundary = result.contentType.split('boundary=')[1]
    expect(result.body.toString()).toContain(`--${boundary}`)
    expect(result.body.toString()).toContain(`--${boundary}--`)

    // Body should have HTTP status lines
    expect(result.body.toString()).toContain('HTTP/1.1 200 OK')
    expect(result.body.toString()).toContain('HTTP/1.1 204 No Content')

    // Body should contain the first part's data
    expect(result.body.toString()).toContain('"Widget"')

    // Should have Content-Type: application/http for each part
    const httpTypeCount = (result.body.toString().match(/Content-Type: application\/http/g) ?? [])
      .length
    expect(httpTypeCount).toBe(2)
  })

  it('nests a successful changeset in its own multipart/mixed part (OData-Protocol §11.7.7.5)', () => {
    const result = buildBatchResponse([
      { statusCode: 200, headers: {}, body: '{"value":[]}' },
      {
        kind: 'changeset',
        parts: [
          { contentId: '1', statusCode: 201, headers: { location: '/odata/P(1)' }, body: '{}' },
          { contentId: '2', statusCode: 204, headers: {} },
        ],
      },
    ])
    const outer = result.contentType.split('boundary=')[1]
    const nested = /Content-Type: multipart\/mixed; boundary=(\S+)/.exec(
      result.body.toString(),
    )?.[1]
    expect(nested).toBeDefined()
    expect(nested).not.toBe(outer)
    // Two top-level parts: the operation and the changeset.
    expect(result.body.toString().split(`--${outer}\r\n`).length - 1).toBe(2)
    expect(result.body.toString().split(`--${nested}\r\n`).length - 1).toBe(2)
    expect(result.body.toString()).toContain(`--${nested}--`)
    const changesetBody = result.body
      .toString()
      .slice(result.body.toString().indexOf(`--${nested}`))
    expect(changesetBody).toContain('Content-ID: 1')
    expect(changesetBody).toContain('HTTP/1.1 201 Created')
    expect(changesetBody).toContain('Location: /odata/P(1)')
    expect(changesetBody).toContain('Content-ID: 2')
  })

  it('a failed changeset is a single application/http part (no nested multipart)', () => {
    const errorBody = JSON.stringify({ error: { code: 'NotFound', message: 'x', details: [] } })
    const result = buildBatchResponse([
      { contentId: '2', statusCode: 404, headers: { 'content-language': 'en' }, body: errorBody },
    ])
    expect(result.body.toString()).not.toContain('multipart/mixed')
    expect((result.body.toString().match(/HTTP\/1\.1 404 Not Found/g) ?? []).length).toBe(1)
    expect(result.body.toString()).toContain('Content-ID: 2')
    expect(result.body.toString()).toContain('Content-Language: en')
  })

  it("uses the operation's own Content-Type (e.g. text/plain for $count)", () => {
    const result = buildBatchResponse([
      { statusCode: 200, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: '3' },
    ])
    expect(result.body.toString()).toContain('Content-Type: text/plain; charset=utf-8')
    expect(result.body.toString()).not.toContain('Content-Type: application/json')
  })

  it('includes Content-ID when present', () => {
    const parts: BatchResponsePart[] = [
      {
        contentId: '1',
        statusCode: 201,
        headers: {},
        body: JSON.stringify({ id: 42 }),
      },
    ]

    const result = buildBatchResponse(parts)

    expect(result.body.toString()).toContain('Content-ID: 1')
    expect(result.body.toString()).toContain('HTTP/1.1 201 Created')
  })

  it('produces valid multipart format with CRLF line endings', () => {
    const parts: BatchResponsePart[] = [{ statusCode: 200, headers: {}, body: '{"value":[]}' }]

    const result = buildBatchResponse(parts)

    // OData spec requires CRLF in multipart bodies
    expect(result.body.toString()).toContain('\r\n')
  })

  it('generates unique boundaries for each call', () => {
    const parts: BatchResponsePart[] = [{ statusCode: 200, headers: {} }]
    const r1 = buildBatchResponse(parts)
    const r2 = buildBatchResponse(parts)

    const boundary1 = r1.contentType.split('boundary=')[1]
    const boundary2 = r2.contentType.split('boundary=')[1]

    expect(boundary1).not.toBe(boundary2)
  })

  it('writes binary bodies byte for byte and one line per multi-valued header', () => {
    const bytes = Buffer.from([0xff, 0x00, 0x80])
    const result = buildBatchResponse([
      {
        statusCode: 200,
        headers: { 'content-type': 'image/png', 'set-cookie': ['a=1', 'b=2'] },
        body: bytes,
      },
    ])
    expect(Buffer.isBuffer(result.body)).toBe(true)
    expect(result.body.includes(bytes)).toBe(true)
    expect(result.body.toString()).toContain('Content-Length: 3')
    expect(result.body.toString()).toContain('Set-Cookie: a=1\r\nSet-Cookie: b=2\r\n')
  })
})
