/**
 * OData v4 $batch multipart/mixed body parser.
 *
 * Custom parser with zero external dependencies per D-01.
 * Implements OData v4 Part 1 section 11 wire format.
 *
 * Security (T-05-01): validates boundary format, throws ODataValidationError
 * on malformed input — never passes invalid data through.
 */

import { ODataValidationError } from '../query/odata-validation.error.js'
import type { BatchChangesetPart, BatchPart, BatchRequestPart, ParsedBatch } from './batch-types.js'

/**
 * Maximum number of operations allowed in a single batch request (T-05-02).
 * Prevents unbounded transaction size and DoS via large batches.
 */
export const MAX_BATCH_OPERATIONS = 100

/**
 * Extract the boundary value from a Content-Type header.
 *
 * Handles both quoted (boundary="abc") and unquoted (boundary=abc) formats.
 * Throws ODataValidationError if the boundary parameter is missing.
 *
 * @param contentType - The Content-Type header value (e.g., 'multipart/mixed; boundary=batch_abc123')
 * @returns The boundary string value
 * @throws ODataValidationError if boundary parameter is missing
 */
export function extractBoundary(contentType: string): string {
  // Match both quoted: boundary="value" and unquoted: boundary=value
  const match = /boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(contentType)
  if (!match) {
    throw new ODataValidationError(
      'Missing boundary parameter in Content-Type header for $batch request',
      '$batch',
      'boundary',
    )
  }
  // match[1] is quoted form, match[2] is unquoted form
  return match[1] ?? match[2] ?? ''
}

/**
 * Parse a multipart/mixed batch body into structured BatchPart objects.
 *
 * Handles:
 *   - Individual request parts (kind: 'request')
 *   - Changesets (kind: 'changeset') containing sub-request parts
 *   - Both CRLF (\r\n) and LF (\n) line endings
 *   - Content-ID headers for changeset sub-parts
 *   - Embedded HTTP request parsing (METHOD URL HTTP/1.1, headers, body)
 *
 * Per T-05-02: rejects batches exceeding MAX_BATCH_OPERATIONS operations.
 *
 * @param body - The raw request body string
 * @param boundary - The multipart boundary (from extractBoundary())
 * @returns ParsedBatch with all parsed parts
 * @throws ODataValidationError if body is malformed or exceeds limits
 */
export function parseBatchBody(body: string, boundary: string): ParsedBatch {
  if (!body || body.trim() === '') {
    return { boundary, parts: [] }
  }

  // Normalize line endings to \n for consistent parsing
  const normalized = body.replace(/\r\n/g, '\n')

  const parts = splitByBoundary(normalized, boundary)
  let totalOperations = 0

  const batchParts: BatchPart[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    const parsed = parsePart(trimmed)
    if (parsed) {
      // Count operations for limit enforcement (T-05-02)
      if (parsed.kind === 'request') {
        totalOperations++
      } else if (parsed.kind === 'changeset') {
        totalOperations += parsed.parts.length
      }

      if (totalOperations > MAX_BATCH_OPERATIONS) {
        throw new ODataValidationError(
          `Batch request exceeds maximum of ${MAX_BATCH_OPERATIONS} operations`,
          '$batch',
          'operations',
        )
      }

      batchParts.push(parsed)
    }
  }

  return { boundary, parts: batchParts }
}

/**
 * Split a normalized (LF-only) body by the multipart boundary.
 * Returns the content segments between boundary markers.
 */
function splitByBoundary(body: string, boundary: string): string[] {
  const delimiter = `--${boundary}`
  const terminator = `--${boundary}--`

  const lines = body.split('\n')
  const segments: string[] = []
  let currentSegment: string[] = []
  let inSegment = false

  for (const line of lines) {
    const trimmedLine = line.trimEnd()

    if (trimmedLine === terminator) {
      // End of multipart body
      if (inSegment && currentSegment.length > 0) {
        segments.push(currentSegment.join('\n'))
      }
      // Reset so the post-loop guard does not push the same segment again
      inSegment = false
      currentSegment = []
      break
    } else if (trimmedLine === delimiter) {
      // Start of a new part
      if (inSegment && currentSegment.length > 0) {
        segments.push(currentSegment.join('\n'))
        currentSegment = []
      }
      inSegment = true
    } else if (inSegment) {
      currentSegment.push(line)
    }
  }

  // Handle case where there's no terminator
  if (inSegment && currentSegment.length > 0) {
    segments.push(currentSegment.join('\n'))
  }

  return segments
}

/**
 * Parse a single multipart segment into a BatchPart.
 * Detects whether it's a changeset or an individual request.
 */
function parsePart(segment: string): BatchPart | null {
  // A segment has MIME headers followed by blank line followed by content
  const blankLineIdx = segment.indexOf('\n\n')
  if (blankLineIdx === -1) {
    throw new ODataValidationError(
      'Malformed batch part: missing blank line separator between headers and content',
      '$batch',
      'part',
    )
  }

  const headerSection = segment.slice(0, blankLineIdx)
  const content = segment.slice(blankLineIdx + 2)

  const partHeaders = parseMimeHeaders(headerSection)
  const contentType = getHeaderValue(partHeaders, 'content-type')

  if (contentType && contentType.toLowerCase().startsWith('multipart/mixed')) {
    // This part is a changeset
    return parseChangeset(content, contentType)
  } else {
    // This part is an individual request (application/http)
    return parseRequestPart(content, partHeaders)
  }
}

/**
 * Parse a changeset part (kind: 'changeset') by recursively parsing its sub-parts.
 */
function parseChangeset(content: string, changesetContentType: string): BatchChangesetPart {
  const changesetBoundary = extractBoundary(changesetContentType)
  const subSegments = splitByBoundary(content.trim(), changesetBoundary)
  const subParts: BatchRequestPart[] = []

  for (const subSegment of subSegments) {
    const trimmed = subSegment.trim()
    if (!trimmed) continue

    const blankLineIdx = trimmed.indexOf('\n\n')
    if (blankLineIdx === -1) {
      throw new ODataValidationError(
        'Malformed changeset sub-part: missing blank line separator',
        '$batch',
        'changeset-part',
      )
    }

    const subHeaderSection = trimmed.slice(0, blankLineIdx)
    const subContent = trimmed.slice(blankLineIdx + 2)
    const subHeaders = parseMimeHeaders(subHeaderSection)

    const requestPart = parseRequestPart(subContent, subHeaders)
    if (requestPart) {
      subParts.push(requestPart)
    }
  }

  return { kind: 'changeset', parts: subParts }
}

/**
 * Parse an individual HTTP request embedded in a batch part.
 *
 * The content is an embedded HTTP request:
 *   METHOD URL HTTP/1.1\n
 *   Header-Name: value\n
 *   \n
 *   [optional body]
 */
function parseRequestPart(content: string, mimeHeaders: Record<string, string>): BatchRequestPart {
  const trimmedContent = content.trim()
  const lines = trimmedContent.split('\n')

  if (lines.length === 0 || !lines[0]) {
    throw new ODataValidationError(
      'Malformed batch sub-request: empty content',
      '$batch',
      'request',
    )
  }

  // First line: METHOD URL HTTP/1.1
  const requestLine = lines[0].trimEnd()
  const requestLineMatch = /^(\S+)\s+(\S+)(?:\s+HTTP\/\S+)?$/.exec(requestLine)
  if (!requestLineMatch) {
    throw new ODataValidationError(
      `Malformed batch sub-request line: '${requestLine}'`,
      '$batch',
      'request-line',
    )
  }

  const method = requestLineMatch[1] ?? ''
  const url = requestLineMatch[2] ?? ''

  // Parse HTTP headers until blank line
  const httpHeaders: Record<string, string> = {}
  let bodyStartIdx = 1

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trimEnd()
    if (line === '') {
      bodyStartIdx = i + 1
      break
    }
    const colonIdx = line.indexOf(':')
    if (colonIdx !== -1) {
      const headerName = line.slice(0, colonIdx).trim().toLowerCase()
      const headerValue = line.slice(colonIdx + 1).trim()
      httpHeaders[headerName] = headerValue
    }
    bodyStartIdx = i + 1
  }

  // Extract body if present
  const bodyLines = lines.slice(bodyStartIdx)
  const bodyStr = bodyLines.join('\n').trim()
  const body = bodyStr || undefined

  // Extract Content-ID from MIME headers (present in changeset sub-parts)
  const contentId = getHeaderValue(mimeHeaders, 'content-id')
  let resolvedContentId: string | undefined
  if (contentId !== undefined) {
    const stripped = contentId.replace(/^<|>$/g, '')
    // OData spec requires Content-ID to be a positive integer (numeric only).
    // Reject non-numeric values to prevent RegExp injection via Content-ID references.
    if (!/^\d+$/.test(stripped)) {
      throw new ODataValidationError(
        `Invalid Content-ID '${stripped}': must be a positive integer per OData v4 spec`,
        '$batch',
        'content-id',
      )
    }
    resolvedContentId = stripped
  }

  return {
    kind: 'request',
    contentId: resolvedContentId,
    method: method.toUpperCase(),
    url,
    headers: httpHeaders,
    body,
  }
}

/**
 * Parse MIME-style headers from a header section string.
 * Returns a map of lowercase header names to values.
 */
function parseMimeHeaders(headerSection: string): Record<string, string> {
  const headers: Record<string, string> = {}
  const lines = headerSection.split('\n')

  for (const line of lines) {
    const trimmedLine = line.trimEnd()
    if (!trimmedLine) continue

    const colonIdx = trimmedLine.indexOf(':')
    if (colonIdx !== -1) {
      const name = trimmedLine.slice(0, colonIdx).trim().toLowerCase()
      const value = trimmedLine.slice(colonIdx + 1).trim()
      headers[name] = value
    }
  }

  return headers
}

/**
 * Get a header value by name (case-insensitive lookup).
 * Returns undefined if not found.
 */
function getHeaderValue(headers: Record<string, string>, name: string): string | undefined {
  return headers[name.toLowerCase()]
}
