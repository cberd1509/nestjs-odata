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
 * caller (the current batch part, a changeset's transaction) are visible to the route.
 *
 * Zero ORM imports — per PKG-01 architecture constraint.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { Writable } from 'node:stream'

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
 * The `$batch` operation being handled, or `undefined` for a request that is not part of a
 * `$batch`. Guards, interceptors, route handlers and hooks can read it to apply a batch-specific
 * policy (for example refusing some operations inside a batch).
 */
export function getODataBatchPart(): ODataBatchPartContext | undefined {
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
 */
export function batchOperationHeaders(
  batchHeaders: Readonly<Record<string, string | string[] | undefined>>,
  partHeaders: Readonly<Record<string, string>>,
  hasBody: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(batchHeaders)) {
    const key = name.toLowerCase()
    if (value === undefined || NOT_INHERITED.has(key)) continue
    headers[key] = Array.isArray(value) ? value.join(', ') : value
  }
  for (const [name, value] of Object.entries(partHeaders)) {
    headers[name.toLowerCase()] = value
  }
  if (hasBody && !headers['content-type']) headers['content-type'] = 'application/json'
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
}

/** The response of an operation run through the application. */
export interface BatchOperationResponse {
  readonly statusCode: number
  /** Response headers, lower-case, without connection-level headers. */
  readonly headers: Readonly<Record<string, string>>
  /** Response body, `undefined` when empty. */
  readonly body?: string
}

/** Response headers that describe the connection or the envelope, not the operation. */
const DROPPED_RESPONSE_HEADERS = new Set([
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'date',
  'x-powered-by',
])

/** Minimal shape of Nest's `HttpAdapterHost.httpAdapter`. */
export interface BatchHttpAdapter {
  getInstance(): unknown
}

interface InjectResponse {
  readonly statusCode: number
  readonly headers: Readonly<Record<string, string | string[] | number | undefined>>
  readonly payload: string
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
      resolve({
        statusCode: res.statusCode,
        headers: res.getHeaders(),
        payload: Buffer.concat(chunks).toString('utf-8'),
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
  const options: InjectOptions = {
    method: operation.method.toUpperCase(),
    url: operation.url,
    headers: { ...operation.headers },
    ...(operation.body !== undefined && operation.body !== '' ? { payload: operation.body } : {}),
    ...(operation.remoteAddress ? { remoteAddress: operation.remoteAddress } : {}),
  }
  let response: InjectResponse
  if (hasInject(instance)) {
    response = await instance.inject(options)
  } else if (typeof instance === 'function') {
    response = await injectIntoHandler(instance as RequestHandler, options)
  } else {
    throw new Error('$batch: the HTTP adapter instance cannot dispatch requests in process')
  }
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(response.headers)) {
    const key = name.toLowerCase()
    if (value === undefined || DROPPED_RESPONSE_HEADERS.has(key)) continue
    headers[key] = Array.isArray(value) ? value.join(', ') : String(value)
  }
  return {
    statusCode: response.statusCode,
    headers,
    body: response.payload === '' ? undefined : response.payload,
  }
}
