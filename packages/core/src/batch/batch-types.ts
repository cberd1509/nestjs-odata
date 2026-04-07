/**
 * OData v4 $batch type definitions.
 *
 * Per OData v4 Part 1 section 11, a batch request contains multiple
 * operations in a multipart/mixed body. Operations can be:
 *   - Individual requests: GET, DELETE, or data modification operations
 *   - Changesets: groups of data modification operations that must succeed or fail atomically
 *
 * These types form the contract between batch-parser.ts and batch-controller.ts.
 */

/**
 * Represents a single parsed sub-request from a batch body.
 * Produced by parseBatchBody() for individual requests and changeset sub-parts.
 */
export interface BatchRequestPart {
  readonly kind: 'request'
  /** Content-ID header value for referencing the result within a changeset */
  readonly contentId?: string
  /** HTTP method: GET, POST, PATCH, PUT, DELETE */
  readonly method: string
  /** The URL from the embedded HTTP request line */
  readonly url: string
  /** Parsed headers from the embedded HTTP request */
  readonly headers: Readonly<Record<string, string>>
  /** Raw body string for POST/PATCH/PUT requests, undefined for GET/DELETE */
  readonly body?: string
}

/**
 * Represents a changeset — a group of data modification operations
 * that must be executed atomically (all succeed or all roll back).
 *
 * Per OData v4 Part 1 section 11.7: changesets cannot contain GET requests.
 */
export interface BatchChangesetPart {
  readonly kind: 'changeset'
  /** The individual sub-requests within this changeset */
  readonly parts: readonly BatchRequestPart[]
}

/**
 * A part in a batch body — either an individual request or a changeset.
 */
export type BatchPart = BatchRequestPart | BatchChangesetPart

/**
 * The fully parsed result of a multipart/mixed batch body.
 */
export interface ParsedBatch {
  readonly boundary: string
  readonly parts: readonly BatchPart[]
}

/**
 * Represents the HTTP response for a single operation within a batch response.
 */
export interface BatchResponsePart {
  /** Content-ID from the corresponding request part, if any */
  readonly contentId?: string
  /** HTTP status code for this operation */
  readonly statusCode: number
  /** Response headers for this operation */
  readonly headers: Readonly<Record<string, string>>
  /** Serialized response body, if any */
  readonly body?: string
}

/**
 * The complete batch response, ready to be serialized to multipart/mixed.
 */
export interface BatchResponse {
  readonly boundary: string
  readonly parts: readonly BatchResponsePart[]
}
