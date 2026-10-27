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
import { STATUS_CODES } from 'node:http'
import type { BatchResponseItem, BatchResponsePart } from '@nestjs-odata/core'

/** Header words whose canonical spelling is not plain capitalisation. */
const HEADER_WORDS: Record<string, string> = {
  etag: 'ETag',
  odata: 'OData',
  id: 'ID',
  www: 'WWW',
  entityid: 'EntityId',
  maxversion: 'MaxVersion',
  isolation: 'Isolation',
}

/**
 * Canonical casing of a header name: each hyphen-separated word capitalised (`set-cookie` →
 * `Set-Cookie`), with the usual exceptions (`ETag`, `OData-EntityId`, `Content-ID`,
 * `WWW-Authenticate`). HTTP header names are case-insensitive; this is for readability.
 */
function canonicalHeaderName(name: string): string {
  return name
    .toLowerCase()
    .split('-')
    .map((word) => HEADER_WORDS[word] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join('-')
}

/** A fresh multipart boundary. */
function newBoundary(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

/**
 * One `application/http` part (after its boundary delimiter): its MIME and HTTP header block as
 * one string, and its body (text or bytes) as a separate chunk.
 */
function operationChunks(part: BatchResponsePart): Buffer[] {
  const lines: string[] = ['Content-Type: application/http', 'Content-Transfer-Encoding: binary']
  if (part.contentId !== undefined) {
    lines.push(`Content-ID: ${part.contentId}`)
  }
  lines.push('')
  lines.push(`HTTP/1.1 ${part.statusCode} ${STATUS_CODES[part.statusCode] ?? 'Unknown'}`)
  const body =
    part.body === undefined
      ? undefined
      : typeof part.body === 'string'
        ? Buffer.from(part.body, 'utf-8')
        : part.body
  let hasContentType = false
  for (const [name, value] of Object.entries(part.headers)) {
    const key = name.toLowerCase()
    if (key === 'content-length') continue
    if (key === 'content-type') {
      if (body === undefined) continue
      hasContentType = true
    }
    // One line per value: `Set-Cookie` values cannot be joined with commas.
    for (const single of typeof value === 'string' ? [value] : value) {
      lines.push(`${canonicalHeaderName(key)}: ${single}`)
    }
  }
  if (body !== undefined) {
    if (!hasContentType) lines.push('Content-Type: application/json')
    lines.push(`Content-Length: ${body.length}`)
  }
  lines.push('', '')
  const head = Buffer.from(lines.join('\r\n'), 'utf-8')
  return body === undefined ? [head] : [head, body]
}

/**
 * Build a multipart/mixed batch response from individual operation results.
 *
 * A successful changeset (`BatchChangesetResponse`) is a nested multipart/mixed part with
 * its own boundary, one `application/http` part per changeset request; a failed changeset is a
 * single `application/http` part in its place (OData-Protocol 4.01 §11.7.7.5).
 *
 * @param parts - Array of per-operation (or per-changeset) response descriptors
 * @returns Object with `contentType` (for Content-Type header) and `body` (the response bytes;
 *   binary operation bodies are kept byte for byte)
 */
export function buildBatchResponse(parts: readonly BatchResponseItem[]): {
  contentType: string
  body: Buffer
} {
  const boundary = newBoundary('batch')
  const chunks: Buffer[] = []
  const text = (value: string): void => {
    chunks.push(Buffer.from(value, 'utf-8'))
  }

  for (const part of parts) {
    if ('kind' in part) {
      const changesetBoundary = newBoundary('changeset')
      text(`--${boundary}\r\nContent-Type: multipart/mixed; boundary=${changesetBoundary}\r\n\r\n`)
      for (const operation of part.parts) {
        text(`--${changesetBoundary}\r\n`)
        chunks.push(...operationChunks(operation))
        text('\r\n')
      }
      text(`--${changesetBoundary}--\r\n`)
    } else {
      text(`--${boundary}\r\n`)
      chunks.push(...operationChunks(part))
      text('\r\n')
    }
  }
  text(`--${boundary}--\r\n`)

  return { contentType: `multipart/mixed; boundary=${boundary}`, body: Buffer.concat(chunks) }
}
