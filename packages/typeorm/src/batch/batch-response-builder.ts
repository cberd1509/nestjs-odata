/**
 * OData v4 $batch response builder.
 *
 * Builds a multipart/mixed HTTP response body from per-operation results.
 * Each operation gets its own HTTP status code and body (D-03).
 *
 * Per T-05-05: failed operation responses use OData error format,
 * no stack traces or internal details.
 *
 * Wire format per OData v4 Part 1 section 11:
 *   --{boundary}\r\n
 *   Content-Type: application/http\r\n
 *   Content-Transfer-Encoding: binary\r\n
 *   \r\n
 *   HTTP/1.1 {status} {statusText}\r\n
 *   Content-Type: application/json\r\n
 *   \r\n
 *   {body}\r\n
 *   --{boundary}--\r\n
 */

import { randomUUID } from 'crypto'
import type { BatchResponsePart } from '@nestjs-odata/core'

/**
 * Map of HTTP status codes to reason phrases.
 */
const STATUS_TEXTS: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  503: 'Service Unavailable',
}

/**
 * Build a multipart/mixed batch response from individual operation results.
 *
 * @param parts - Array of per-operation response descriptors
 * @returns Object with `contentType` (for Content-Type header) and `body` (response body string)
 */
export function buildBatchResponse(parts: BatchResponsePart[]): {
  contentType: string
  body: string
} {
  const boundary = `batch_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  const lines: string[] = []

  for (const part of parts) {
    const statusText = STATUS_TEXTS[part.statusCode] ?? 'Unknown'
    lines.push(`--${boundary}`)
    lines.push('Content-Type: application/http')
    lines.push('Content-Transfer-Encoding: binary')
    if (part.contentId !== undefined) {
      lines.push(`Content-ID: ${part.contentId}`)
    }
    lines.push('')
    lines.push(`HTTP/1.1 ${part.statusCode} ${statusText}`)

    if (part.body !== undefined) {
      lines.push('Content-Type: application/json')
      lines.push(`Content-Length: ${Buffer.byteLength(part.body, 'utf-8')}`)
    }
    lines.push('')

    if (part.body !== undefined) {
      lines.push(part.body)
    }
  }

  lines.push(`--${boundary}--`)
  lines.push('')

  const body = lines.join('\r\n')
  const contentType = `multipart/mixed; boundary=${boundary}`

  return { contentType, body }
}
