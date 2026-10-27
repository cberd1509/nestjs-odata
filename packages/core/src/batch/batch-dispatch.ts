/**
 * In-process dispatch of `$batch` operations through the application's own HTTP stack.
 *
 * OData-Protocol 4.01 §11.7: "Individual requests within a batch request are evaluated according
 * to the same semantics used when the request appears outside the context of a batch request."
 * In a NestJS application that means the operation goes through the same middleware, guards,
 * interceptors, pipes, route handler and exception filters as the standalone request. Each
 * operation is therefore injected into the platform's request handler (the Express application,
 * called with a real `IncomingMessage` / `ServerResponse` pair, or Fastify's `inject()`), in
 * process, without opening a socket.
 *
 * The operation's {@link ODataBatchPartContext} travels two ways: in an `AsyncLocalStorage` (the
 * injection runs inside it) and, on Express, on the injected request object, which is read first:
 * middleware may resume `next()` from another async context (a session store, a callback-based
 * auth library), where the async store is lost or belongs to another request.
 *
 * Zero ORM imports — per PKG-01 architecture constraint.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { Writable } from 'node:stream'
import { getODataRequestContext } from '../context/odata-request-context.js'

/** The `$batch` operation the application is currently handling (see {@link getODataBatchPart}). */
export interface ODataBatchPartContext {
  /** HTTP method of the operation, as sent in the batch. */
  readonly method: string
  /** URL of the operation, as sent in the batch (after `$<Content-ID>` references are resolved). */
  readonly url: string
  /** `Content-ID` of the operation, if any. */
  readonly contentId?: string
  /** True when the operation belongs to a changeset (an atomic group). */
  readonly inChangeset: boolean
  /** The platform request of the enclosing `$batch` request. */
  readonly batchRequest: unknown
  /**
   * The changeset's unit of work, set by the adapter for operations of a changeset (for the
   * TypeORM adapter, the transaction's `EntityManager`; see `getODataChangesetManager()`).
   */
  readonly changeset?: unknown
}

const partStorage = new AsyncLocalStorage<ODataBatchPartContext>()

/**
 * Request property (a symbol) holding the {@link ODataBatchPartContext} of a `$batch` operation
 * on the request injected for it (Express adapter).
 */
export const ODATA_BATCH_PART: unique symbol = Symbol.for('@nestjs-odata/batch-part')

/**
 * The `$batch` operation being handled, or `undefined` for a request that is not part of a
 * `$batch`. Guards, interceptors, route handlers and hooks can read it to apply a batch-specific
 * policy (for example refusing some operations inside a batch).
 *
 * Read from `request` when given (pass it from guards and middleware, which run before the
 * OData request context is set), else from the request of the current OData request context,
 * else from the async context.
 */
export function getODataBatchPart(request?: unknown): ODataBatchPartContext | undefined {
  const req = (request ?? getODataRequestContext()?.request) as
    Partial<Record<typeof ODATA_BATCH_PART, ODataBatchPartContext>> | undefined
  if (req && typeof req === 'object' && ODATA_BATCH_PART in req) return req[ODATA_BATCH_PART]
  return partStorage.getStore()
}

/** Runs `fn` with `part` as the current `$batch` operation (see {@link getODataBatchPart}). */
export function runWithODataBatchPart<T>(part: ODataBatchPartContext, fn: () => T): T {
  return partStorage.run(part, fn)
}

/** What the error mapper is told about a failing `$batch` operation. */
export function batchErrorContext(
  part: Pick<ODataBatchPartContext, 'method' | 'url' | 'contentId'>,
): {
  readonly method: string
  readonly url: string
  readonly contentId?: string
} {
  return { method: part.method, url: part.url, contentId: part.contentId }
}

/** The first value of a header (`string[]` for repeated headers). */
export function headerValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.[0]
}

/**
 * Headers of the batch request that operations never inherit: the body and transport headers
 * of the multipart envelope, batch-level preferences (`Prefer`, OData-Protocol §8.2.8.3,
 * §8.2.8.8) and conditional headers, which MUST NOT be sent on a batch request (§8.2.4, §8.2.5).
 */
const NOT_INHERITED = new Set([
  'content-type',
  'content-length',
  'content-encoding',
  'content-id',
  'content-transfer-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'te',
  'trailer',
  'expect',
  'accept',
  'prefer',
  'if-match',
  'if-none-match',
  'if-modified-since',
  'if-unmodified-since',
  'if-range',
  'range',
])

/**
 * The headers of the `$batch` request that its operations inherit (compute once per batch):
 * credentials such as `Authorization` and `Cookie`, `Accept-Language`, `OData-MaxVersion`,
 * custom headers — not the ones in {@link NOT_INHERITED}, nor HTTP/2 pseudo-headers (`:path`).
 * Parts MUST NOT carry authentication headers (§11.7.7.1), so the credentials of the batch
 * request apply to every operation.
 */
export function inheritedBatchHeaders(
  batchHeaders: Readonly<Record<string, string | string[] | undefined>>,
): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(batchHeaders)) {
    const key = name.toLowerCase()
    if (value === undefined || key.startsWith(':') || NOT_INHERITED.has(key)) continue
    headers[key] = Array.isArray(value) ? value.join(', ') : value
  }
  return headers
}

/**
 * The request headers of one batch operation: the {@link inheritedBatchHeaders inherited} ones,
 * overridden by the operation's own. `Content-Length` is never taken from either (the body may
 * have been rewritten; the dispatcher sets it from the real body) and pseudo-headers are ignored.
 * An operation with a body and no `Content-Type` is sent as `application/json`. The operation
 * always asks for `Accept-Encoding: identity`: its response is read in process.
 */
export function batchOperationHeaders(
  inherited: Readonly<Record<string, string>>,
  partHeaders: Readonly<Record<string, string>>,
  hasBody: boolean,
): Record<string, string> {
  const headers: Record<string, string> = { ...inherited }
  for (const [name, value] of Object.entries(partHeaders)) {
    const key = name.toLowerCase()
    if (!key.startsWith(':')) headers[key] = value
  }
  delete headers['content-length']
  if (hasBody && !headers['content-type']) headers['content-type'] = 'application/json'
  headers['accept-encoding'] = 'identity'
  return headers
}

/** Base for parsing the path-only URLs of a `$batch` request (only path and query are used). */
const BATCH_URL_BASE = 'http://batch.invalid'

/** The `$batch` request URL (a path, e.g. `req.originalUrl`), parsed. */
export function parseBatchUrl(batchUrl: string): URL {
  return new URL(batchUrl, BATCH_URL_BASE)
}

/**
 * The URL a batch operation targets (use its `pathname` and `search`). OData-Protocol §11.7.7.1
 * allows an absolute URI, an absolute path, or a path relative to the batch request URL (that
 * is, to the service root). Throws on an unparsable URL.
 */
export function resolveBatchOperationUrl(operationUrl: string, batchUrl: URL | string): URL {
  return new URL(operationUrl, typeof batchUrl === 'string' ? parseBatchUrl(batchUrl) : batchUrl)
}

/** An operation to run through the application. */
export interface BatchOperationRequest {
  readonly method: string
  /** Path and query, e.g. `/odata/Products?$top=1`. */
  readonly url: string
  /** Request headers, as built by {@link batchOperationHeaders}. */
  readonly headers: Readonly<Record<string, string>>
  readonly body?: string
  /** Client address of the `$batch` request, so IP-based policies see the real client. */
  readonly remoteAddress?: string
  /**
   * Milliseconds to wait for the operation's response; then the dispatch rejects with
   * {@link BatchOperationTimeoutError}. Default: no limit.
   */
  readonly timeoutMs?: number
}

/** The operation did not answer within `timeoutMs`. */
export class BatchOperationTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`$batch operation timed out after ${timeoutMs} ms`)
    this.name = 'BatchOperationTimeoutError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** The response of an operation run through the application. */
export interface BatchOperationResponse {
  readonly statusCode: number
  /**
   * Response headers, lower-case, without connection-level headers. Multi-valued headers
   * (`Set-Cookie`) keep one entry per value.
   */
  readonly headers: Readonly<Record<string, string | readonly string[]>>
  /** Response body bytes, `undefined` when empty. */
  readonly body?: Buffer
}

/**
 * Response headers that describe the connection or the envelope, not the operation: the only
 * filter applied to operation responses.
 */
const DROPPED_RESPONSE_HEADERS = new Set([
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'date',
  'x-powered-by',
  // Operations are asked for an identity encoding; the envelope has its own encoding.
  'content-encoding',
])

/** Minimal shape of Nest's `HttpAdapterHost.httpAdapter`. */
export interface BatchHttpAdapter {
  getInstance(): unknown
}

interface InjectResponse {
  readonly statusCode: number
  readonly headers: Readonly<Record<string, string | string[] | number | undefined>>
  /** The body bytes (Fastify's `inject()` response has them too). */
  readonly rawPayload: Buffer
}

interface InjectOptions {
  method: string
  url: string
  headers: Readonly<Record<string, string>>
  payload?: string
  remoteAddress?: string
}

/** A platform instance with its own in-process injection (Fastify). */
interface Injectable {
  inject(options: InjectOptions): Promise<InjectResponse>
}

function hasInject(instance: unknown): instance is Injectable {
  return typeof (instance as { inject?: unknown } | null)?.inject === 'function'
}

/** A Node request handler: the Express application. */
type RequestHandler = (req: IncomingMessage, res: ServerResponse) => unknown

/** A socket that discards what is written to it, standing in for the connection. */
function nullSocket(remoteAddress: string | undefined): Socket {
  const socket = new Writable({
    write(_chunk, _encoding, callback) {
      setImmediate(callback)
    },
  })
  Object.assign(socket, {
    remoteAddress: remoteAddress ?? '127.0.0.1',
    remotePort: 0,
    encrypted: false,
    // Readable, so body parsers (which check `on-finished`) read the request body; reading
    // is driven by the request stream itself, so resume/pause do nothing.
    readable: true,
    resume: () => socket,
    pause: () => socket,
    setTimeout: () => socket,
    setNoDelay: () => socket,
    setKeepAlive: () => socket,
  })
  return socket as unknown as Socket
}

/** A response chunk as a Buffer, without copying the bytes. */
function toBuffer(chunk: unknown, encoding?: unknown): Buffer | undefined {
  if (Buffer.isBuffer(chunk)) return chunk
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf-8')
  }
  if (chunk instanceof Uint8Array)
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  return undefined
}

/**
 * Call a Node request handler with a real `IncomingMessage` / `ServerResponse` pair, in the
 * caller's async context, and collect the response. The response methods that emit the body
 * are overridden on the instance (not on a shared prototype, so the application's real
 * requests are not affected): the platform may replace the prototype of both objects, as
 * Express does. `part` is attached to the request as an own property, which survives that.
 */
function injectIntoHandler(
  handler: RequestHandler,
  options: InjectOptions,
  part: ODataBatchPartContext | undefined,
): Promise<InjectResponse> {
  return new Promise<InjectResponse>((resolve, reject) => {
    const socket = nullSocket(options.remoteAddress)
    const req = new IncomingMessage(socket)
    req.method = options.method
    req.url = options.url
    req.httpVersion = '1.1'
    req.httpVersionMajor = 1
    req.httpVersionMinor = 1
    const body = options.payload !== undefined ? Buffer.from(options.payload, 'utf-8') : undefined
    req.headers = body
      ? { ...options.headers, 'content-length': String(body.length) }
      : { ...options.headers }
    req.rawHeaders = Object.entries(req.headers).flat() as string[]
    if (body) req.push(body)
    req.push(null)
    req.once('end', () => {
      req.complete = true
    })
    if (part) Object.defineProperty(req, ODATA_BATCH_PART, { value: part, enumerable: false })

    const res = new ServerResponse(req)
    res.assignSocket(socket)
    const chunks: Buffer[] = []
    const collect = (chunk: unknown, encoding?: unknown): void => {
      const buffer = toBuffer(chunk, encoding)
      if (buffer) chunks.push(buffer)
    }
    // The platform's own end(), whatever prototype it gives `res` (Express replaces it).
    const end = (cb?: () => void): void => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- applied with `res` as `this`
      Reflect.apply(ServerResponse.prototype.end, res, cb ? [cb] : [])
    }
    Object.assign(res, {
      write(chunk: unknown, encoding?: unknown, callback?: unknown): boolean {
        if (!res.headersSent) res.writeHead(res.statusCode)
        collect(chunk, encoding)
        const cb = typeof encoding === 'function' ? encoding : callback
        if (typeof cb === 'function') process.nextTick(() => (cb as () => void)())
        return true
      },
      end(chunk?: unknown, encoding?: unknown, callback?: unknown): ServerResponse {
        collect(chunk, encoding)
        const cb = [chunk, encoding, callback].find((a) => typeof a === 'function') as
          (() => void) | undefined
        end(cb)
        return res
      },
    })

    let done = false
    res.once('finish', () => {
      done = true
      resolve({
        statusCode: res.statusCode,
        headers: res.getHeaders(),
        rawPayload: Buffer.concat(chunks),
      })
    })
    res.once('close', () => {
      if (!done) reject(new Error('$batch operation: the response was closed before it ended'))
    })

    try {
      handler(req, res)
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

/**
 * Run one operation through the application's HTTP stack, in process: the Fastify instance's
 * `inject()`, else the Express application (a Node request handler). When `part` is given, the
 * operation runs as that `$batch` operation: in its async context and, on Express, with `part`
 * attached to the request (see {@link getODataBatchPart}). Fastify's `inject()` cannot carry
 * request properties: there the async context is the only carrier.
 */
export async function dispatchBatchOperation(
  adapter: BatchHttpAdapter,
  operation: BatchOperationRequest,
  part?: ODataBatchPartContext,
): Promise<BatchOperationResponse> {
  const instance = adapter.getInstance()
  const options: InjectOptions = {
    method: operation.method.toUpperCase(),
    url: operation.url,
    headers: operation.headers,
    ...(operation.body !== undefined && operation.body !== '' ? { payload: operation.body } : {}),
    ...(operation.remoteAddress ? { remoteAddress: operation.remoteAddress } : {}),
  }
  const run = (): Promise<InjectResponse> => {
    if (hasInject(instance)) return instance.inject(options)
    if (typeof instance === 'function') {
      return injectIntoHandler(instance as RequestHandler, options, part)
    }
    return Promise.reject(
      new Error('$batch: the HTTP adapter instance cannot dispatch requests in process'),
    )
  }
  const response = await withTimeout(
    part ? runWithODataBatchPart(part, run) : run(),
    operation.timeoutMs,
  )
  const headers: Record<string, string | readonly string[]> = {}
  for (const [name, value] of Object.entries(response.headers)) {
    const key = name.toLowerCase()
    if (value === undefined || DROPPED_RESPONSE_HEADERS.has(key)) continue
    headers[key] = Array.isArray(value) ? value.map(String) : String(value)
  }
  return {
    statusCode: response.statusCode,
    headers,
    body: response.rawPayload.length === 0 ? undefined : response.rawPayload,
  }
}

/** `pending`, or a {@link BatchOperationTimeoutError} after `timeoutMs` (no limit when unset). */
function withTimeout<T>(pending: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (timeoutMs === undefined || timeoutMs <= 0 || !Number.isFinite(timeoutMs)) return pending
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BatchOperationTimeoutError(timeoutMs)), timeoutMs)
  })
  return Promise.race([pending, timeout]).finally(() => clearTimeout(timer))
}
