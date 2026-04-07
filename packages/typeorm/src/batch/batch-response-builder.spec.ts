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
    expect(result.body).toContain(`--${boundary}`)
    expect(result.body).toContain(`--${boundary}--`)

    // Body should have HTTP status lines
    expect(result.body).toContain('HTTP/1.1 200 OK')
    expect(result.body).toContain('HTTP/1.1 204 No Content')

    // Body should contain the first part's data
    expect(result.body).toContain('"Widget"')

    // Should have Content-Type: application/http for each part
    const httpTypeCount = (result.body.match(/Content-Type: application\/http/g) ?? []).length
    expect(httpTypeCount).toBe(2)
  })

  it('Test 2: failed changeset response — all changeset parts get error status', () => {
    const errorBody = JSON.stringify({
      error: {
        code: 'InternalServerError',
        message: 'Operation failed',
        details: [],
      },
    })

    const parts: BatchResponsePart[] = [
      {
        statusCode: 500,
        headers: {},
        body: errorBody,
      },
      {
        statusCode: 500,
        headers: {},
        body: errorBody,
      },
    ]

    const result = buildBatchResponse(parts)

    expect(result.body).toContain('HTTP/1.1 500 Internal Server Error')
    const errorCount = (result.body.match(/HTTP\/1\.1 500/g) ?? []).length
    expect(errorCount).toBe(2)
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

    expect(result.body).toContain('Content-ID: 1')
    expect(result.body).toContain('HTTP/1.1 201 Created')
  })

  it('produces valid multipart format with CRLF line endings', () => {
    const parts: BatchResponsePart[] = [{ statusCode: 200, headers: {}, body: '{"value":[]}' }]

    const result = buildBatchResponse(parts)

    // OData spec requires CRLF in multipart bodies
    expect(result.body).toContain('\r\n')
  })

  it('generates unique boundaries for each call', () => {
    const parts: BatchResponsePart[] = [{ statusCode: 200, headers: {} }]
    const r1 = buildBatchResponse(parts)
    const r2 = buildBatchResponse(parts)

    const boundary1 = r1.contentType.split('boundary=')[1]
    const boundary2 = r2.contentType.split('boundary=')[1]

    expect(boundary1).not.toBe(boundary2)
  })
})
