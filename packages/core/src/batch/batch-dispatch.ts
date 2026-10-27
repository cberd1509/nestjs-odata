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
 * The injection runs inside the caller's async context, so `AsyncLocalStorage` stores set by the
 * caller (the current batch part, a changeset's transaction) are visible to the route. Because
 * middleware may resume `next()` from another async context (a session store, a callback-based
 * auth library), the caller can also attach values to the injected request object
 * (`attach`), which the library reads first (see {@link getODataBatchRequestValue}).
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
}

const partStorage = new AsyncLocalStorage<ODataBatchPartContext>()

/**
 * Request property (a symbol) holding the {@link ODataBatchPartContext} of a `$batch` operation
 * on the request injected for it.
 */
export const ODATA_BATCH_PART: unique symbol = Symbol.for('@nestjs-odata/batch-part')

/**
 * A value the `$batch` controller attached to the request of the operation being handled
 * (`request[key]`, or `request.raw[key]` for Fastify), from `request` or else the request of the
 * current OData request context. `undefined` when there is none (the caller then falls back to
 * its `AsyncLocalStorage`). A value attached as `null` means "explicitly none".
 *
 * The request is the reliable carrier: an `AsyncLocalStorage` store can be lost, or replaced by
 * another request's, when middleware resumes `next()` from a foreign async context.
 */
export function getODataBatchRequestValue<T>(key: symbol, request?: unknown): T | null | undefined {
  const req = (request ?? getODataRequestContext()?.request) as
    (Record<symbol, unknown> & { raw?: Record<symbol, unknown> }) | undefined
  if (!req || typeof req !== 'object') return undefined
  if (key in req) return req[key] as T | null
  const raw = req.raw
  if (raw && typeof raw === 'object' && key in raw) return raw[key] as T | null
  return undefined
}

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
  const attached = getODataBatchRequestValue<ODataBatchPartContext>(ODATA_BATCH_PART, request)
  if (attached !== undefined) return attached ?? undefined
  return partStorage.getStore()
}

/** Runs `fn` with `part` as the current `$batch` operation (see {@link getODataBatchPart}). */
export function runWithODataBatchPart<T>(part: ODataBatchPartContext, fn: () => T): T {
  return partStorage.run(part, fn)
}

/**
 * Headers of the batch request that operations never inherit: the body and transport headers
 * of the multipart envelope, batch-level preferences (`Prefer`, OData-Protocol §8.2.8.3,
 * §8.2.8.8) and conditional headers, which MUST NOT be sent on a batch request (§8.2.4, §8.2.5).
 */
const NOT_INHERITED = new Set([
  // The response is read in process: the operation always gets an unencoded body.
  'accept-encoding',
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
 * The headers of one batch operation: the headers of the `$batch` request (credentials such as
 * `Authorization` and `Cookie`, `Accept-Language`, `OData-MaxVersion`, custom headers), except the
 * ones in {@link NOT_INHERITED}, overridden by the operation's own headers. Parts MUST NOT carry
 * authentication headers (§11.7.7.1), so the credentials of the batch request apply to every
 * operation. An operation with a body and no `Content-Type` is sent as `application/json`.
 * HTTP/2 pseudo-headers (`:path`, `:authority`, ...) are never inherited, and the operation asks
 * for `Accept-Encoding: identity`.
 */
export function batchOperationHeaders(
  batchHeaders: Readonly<Record<string, string | string[] | undefined>>,
  partHeaders: Readonly<Record<string, string>>,
  hasBody: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(batchHeaders)) {
    const key = name.toLowerCase()
    if (value === undefined || key.startsWith(':') || NOT_INHERITED.has(key)) continue
    headers[key] = Array.isArray(value) ? value.join(', ') : value
  }
  for (const [name, value] of Object.entries(partHeaders)) {
    const key = name.toLowerCase()
    if (key.startsWith(':')) continue
    headers[key] = value
  }
  if (hasBody && !headers['content-type']) headers['content-type'] = 'application/json'
  headers['accept-encoding'] = 'identity'
  return headers
}

/**
 * The path and query a batch operation's URL targets. OData-Protocol §11.7.7.1 allows an
 * absolute URI, an absolute path, or a path relative to the batch request URL (that is, to the
 * service root).
 */
export function resolveBatchOperationUrl(operationUrl: string, batchUrl: string): string {
  const base = new URL(batchUrl, 'http://batch.invalid')
  const target = new URL(operationUrl, base)
  return `${target.pathname}${target.search}`
}

/** An operation to run through the application. */
export interface BatchOperationRequest {
  readonly method: string
  /** Path and query, e.g. `/odata/Products?$top=1`. */
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body?: string
  /** Client address of the `$batch` request, so IP-based policies see the real client. */
  readonly remoteAddress?: string
  /**
   * Properties (symbol keys) set on the injected request object before it is handled, read back
   * with {@link getODataBatchRequestValue}. Not supported by Fastify's `inject()`.
   */
  readonly attach?: Readonly<Record<symbol, unknown>>
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
  /**
   * Response body, `undefined` when empty: a string for textual content (JSON, XML, `text/*`,
   * or a `charset`), else the raw bytes.
   */
  readonly body?: string | Buffer
}

/** Response headers that describe the connection or the envelope, not the operation. */
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

/** True for a body to hand over as text (no content type, JSON, XML, `text/*`, a charset). */
function isTextual(contentType: string | undefined): boolean {
  if (!contentType) return true
  const type = contentType.toLowerCase()
  return (
    type.startsWith('text/') ||
    type.includes('charset=') ||
    /^application\/([\w.-]+\+)?(json|xml)\b/.test(type) ||
    type.startsWith('application/x-www-form-urlencoded')
  )
}

/** Minimal shape of Nest's `HttpAdapterHost.httpAdapter`. */
export interface BatchHttpAdapter {
  getInstance(): unknown
}

interface InjectResponse {
  readonly statusCode: number
  readonly headers: Readonly<Record<string, string | string[] | number | undefined>>
  readonly payload: string
  /** The body bytes (Fastify's `inject()` response has them too). */
  readonly rawPayload?: Buffer
}

interface InjectOptions {
  method: string
  url: string
  headers: Record<string, string>
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

/**
 * Call a Node request handler with a real `IncomingMessage` / `ServerResponse` pair, in the
 * caller's async context, and collect the response. The response methods that emit the body
 * are overridden on the instance (not on a shared prototype, so the application's real
 * requests are not affected): the platform may replace the prototype of both objects, as
 * Express does.
 */
function injectIntoHandler(
  handler: RequestHandler,
  options: InjectOptions,
  attach: Readonly<Record<symbol, unknown>> | undefined,
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
    const headers: Record<string, string> = { ...options.headers }
    if (body) headers['content-length'] = String(body.length)
    else delete headers['content-length']
    req.headers = headers
    req.rawHeaders = Object.entries(headers).flat()
    if (body) req.push(body)
    req.push(null)
    req.once('end', () => {
      req.complete = true
    })
    // Own properties survive the platform replacing the request's prototype (Express does).
    for (const key of Object.getOwnPropertySymbols(attach ?? {})) {
      Object.defineProperty(req, key, { value: attach?.[key], enumerable: false })
    }

    const res = new ServerResponse(req)
    res.assignSocket(socket)
    const chunks: Buffer[] = []
    const collect = (chunk: unknown, encoding?: unknown): void => {
      if (chunk === undefined || chunk === null || typeof chunk === 'function') return
      if (typeof chunk === 'string') {
        chunks.push(
          Buffer.from(chunk, typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf-8'),
        )
      } else if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk))
      }
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
      const rawPayload = Buffer.concat(chunks)
      resolve({
        statusCode: res.statusCode,
        headers: res.getHeaders(),
        payload: rawPayload.toString('utf-8'),
        rawPayload,
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
 * `inject()`, else the Express application (a Node request handler).
 */
export async function dispatchBatchOperation(
  adapter: BatchHttpAdapter,
  operation: BatchOperationRequest,
): Promise<BatchOperationResponse> {
  const instance = adapter.getInstance()
  const headers = { ...operation.headers }
  // The body may have been rewritten ($<Content-ID> substitution): the platform computes it.
  delete headers['content-length']
  const options: InjectOptions = {
    method: operation.method.toUpperCase(),
    url: operation.url,
    headers,
    ...(operation.body !== undefined && operation.body !== '' ? { payload: operation.body } : {}),
    ...(operation.remoteAddress ? { remoteAddress: operation.remoteAddress } : {}),
  }
  let pending: Promise<InjectResponse>
  if (hasInject(instance)) {
    pending = instance.inject(options)
  } else if (typeof instance === 'function') {
    pending = injectIntoHandler(instance as RequestHandler, options, operation.attach)
  } else {
    throw new Error('$batch: the HTTP adapter instance cannot dispatch requests in process')
  }
  const response = await withTimeout(pending, operation.timeoutMs)
  const responseHeaders: Record<string, string | readonly string[]> = {}
  for (const [name, value] of Object.entries(response.headers)) {
    const key = name.toLowerCase()
    if (value === undefined || DROPPED_RESPONSE_HEADERS.has(key)) continue
    responseHeaders[key] = Array.isArray(value) ? value.map(String) : String(value)
  }
  const contentType = responseHeaders['content-type']
  const textual = isTextual(typeof contentType === 'string' ? contentType : contentType?.[0])
  const bytes = response.rawPayload ?? Buffer.from(response.payload, 'utf-8')
  return {
    statusCode: response.statusCode,
    headers: responseHeaders,
    body: bytes.length === 0 ? undefined : textual ? bytes.toString('utf-8') : bytes,
  }
}

/** `pending`, or a {@link BatchOperationTimeoutError} after `timeoutMs` (no limit when unset). */
function withTimeout<T>(pending: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (timeoutMs === undefined || timeoutMs <= 0 || !Number.isFinite(timeoutMs)) return pending
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new BatchOperationTimeoutError(timeoutMs)), timeoutMs)
    pending.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      },
    )
  })
}
