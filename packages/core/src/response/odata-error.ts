import { HttpException, HttpStatus, Logger } from '@nestjs/common'
import type { ArgumentsHost } from '@nestjs/common'
import { ODataParseError } from '../parser/errors.js'
import { ODataValidationError } from '../query/odata-validation.error.js'

/** One entry of an OData error's `details` array (OData v4 JSON format §21). */
export interface ODataErrorDetail {
  readonly code: string
  readonly message: string
  readonly target?: string | null
}

/**
 * What an {@link ODataErrorMapper} returns: the OData error to send for an exception.
 *
 * Serialized as `{ "error": { code, message, target?, details, innererror? } }` with HTTP
 * status `status`.
 */
export interface ODataErrorMapping {
  /** HTTP status code, 400–599. */
  readonly status: number
  /** Service-defined error code, e.g. `'CLIENT_NOT_FOUND'`. */
  readonly code: string
  /** Human-readable message, sent to the client as is. */
  readonly message: string
  /** The target of the error, e.g. the property name that failed validation (may be null). */
  readonly target?: string | null
  /** Additional errors, e.g. one per invalid property. */
  readonly details?: readonly ODataErrorDetail[]
  /** Service-defined debugging information. Do not put secrets or stack traces here. */
  readonly innererror?: Readonly<Record<string, unknown>>
}

/** Where the exception being mapped was thrown. */
export interface ODataErrorMapperContext {
  /**
   * The Nest arguments host of the failing route, when the error is caught by
   * `ODataExceptionFilter`. Undefined for `$batch` parts.
   */
  readonly host?: ArgumentsHost
  /** The platform request (for `$batch` parts, the `$batch` request). */
  readonly request?: unknown
  /**
   * Set when the error comes from a `$batch` request: from one operation (`method`, `url`,
   * `contentId`), or from a changeset as a whole (`changeset: true`, no operation fields).
   */
  readonly batch?: {
    readonly method?: string
    readonly url?: string
    readonly contentId?: string
    readonly changeset?: boolean
  }
}

/**
 * Maps any exception thrown while handling an OData request to the OData error to send.
 * Return `undefined` to fall back to the library's default mapping.
 *
 * It runs for the routes declared with the OData route decorators (`@ODataGet`, `@ODataPost`,
 * …), for `$metadata` and for every failing operation of a `$batch` request. It must be
 * synchronous. If it throws, returns a Promise or returns an invalid mapping, a warning is
 * logged and the default mapping is used.
 */
export type ODataErrorMapper = (
  exception: unknown,
  context: ODataErrorMapperContext,
) => ODataErrorMapping | undefined | null

/** The serialized OData error and its HTTP status. */
export interface ODataErrorResponse {
  readonly status: number
  readonly body: {
    readonly error: {
      readonly code: string
      readonly message: string
      readonly target?: string | null
      readonly details: readonly unknown[]
      readonly innererror?: Readonly<Record<string, unknown>>
    }
  }
}

const STATUS_CODES: Record<number, string> = {
  400: 'BadRequest',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'NotFound',
  405: 'MethodNotAllowed',
  409: 'Conflict',
  410: 'Gone',
  412: 'PreconditionFailed',
  422: 'UnprocessableEntity',
  429: 'TooManyRequests',
  500: 'InternalServerError',
  501: 'NotImplemented',
  503: 'ServiceUnavailable',
}

/** Map an HTTP status to the OData error code the library uses by default. */
export function httpStatusToODataCode(status: number): string {
  return STATUS_CODES[status] ?? 'Error'
}

/** The message sent for 5xx errors: their own messages may carry internal details. */
const INTERNAL_ERROR_MESSAGE = 'An unexpected error occurred.'

const logger = new Logger('ODataErrorMapper')

/** An OData error body: `{ error: { code, message, details } }`. */
export function odataErrorBody(
  code: string,
  message: string,
  details: readonly unknown[] = [],
): ODataErrorResponse['body'] {
  return { error: { code, message, details } }
}

/**
 * The HTTP status an error that is not an `HttpException` carries, http-errors style
 * (`status` or `statusCode`, 400–599). Undefined when it carries none.
 */
function carriedStatus(exception: unknown): number | undefined {
  if (exception === null || typeof exception !== 'object') return undefined
  const { status, statusCode } = exception as { status?: unknown; statusCode?: unknown }
  const value = typeof status === 'number' ? status : statusCode
  return isErrorStatus(value) ? value : undefined
}

/** An integer HTTP error status, 400–599. */
function isErrorStatus(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599
}

/** An error response for `status`; 5xx messages are replaced by a generic one. */
function statusResponse(status: number, message: string): ODataErrorResponse {
  return {
    status,
    body: odataErrorBody(
      httpStatusToODataCode(status),
      status >= 500 ? INTERNAL_ERROR_MESSAGE : message,
    ),
  }
}

/**
 * The default mapping: OData parse/validation errors, HttpExceptions, errors carrying a
 * numeric `status`/`statusCode`, and 500 for the rest. 5xx messages are never sent.
 */
function defaultErrorResponse(exception: unknown, depth = 0): ODataErrorResponse {
  if (exception instanceof ODataParseError) {
    return {
      status: HttpStatus.BAD_REQUEST,
      body: odataErrorBody(
        'BadRequest',
        exception.message,
        exception.queryContext
          ? [
              {
                code: 'QueryOption',
                message: `Error near: ${exception.queryContext}`,
                target: exception.queryContext,
              },
            ]
          : [],
      ),
    }
  }
  if (exception instanceof ODataValidationError) {
    return {
      status: HttpStatus.BAD_REQUEST,
      body: odataErrorBody(
        'BadRequest',
        exception.message,
        exception.availableProperties && exception.availableProperties.length > 0
          ? [
              {
                // JSON §21.1: every detail has a code and a message. `value` is kept.
                code: 'AvailableProperties',
                message: `Available properties: ${exception.availableProperties.join(', ')}`,
                target: 'availableProperties',
                value: [...exception.availableProperties],
              },
            ]
          : [],
      ),
    }
  }
  if (exception instanceof HttpException) {
    // HttpExceptions built with an OData-shaped body ({ error: { message } }) keep its message.
    const response = exception.getResponse() as { error?: { message?: unknown } } | string
    const odataMessage =
      typeof response === 'object' && typeof response?.error?.message === 'string'
        ? response.error.message
        : undefined
    return statusResponse(exception.getStatus(), odataMessage ?? exception.message)
  }
  // An error wrapped by application code (`new Error('…', { cause })`): map what it wraps.
  const cause = (exception as { cause?: unknown } | null)?.cause
  if (cause !== undefined && depth < 5 && !(exception instanceof HttpException)) {
    const wrapped = defaultErrorResponse(cause, depth + 1)
    if (wrapped.status < 500) return wrapped
  }
  const status = carriedStatus(exception)
  if (status !== undefined) {
    const message = (exception as { message?: unknown }).message
    return statusResponse(status, typeof message === 'string' ? message : 'Request error')
  }
  // Generic error — never leak internal details (T-03-08)
  return statusResponse(HttpStatus.INTERNAL_SERVER_ERROR, INTERNAL_ERROR_MESSAGE)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A non-empty string: OData requires `code` and `message` to be non-empty (JSON §21.1). */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** OData JSON §21.1: `target` is a (possibly empty) string, or null. */
function isTarget(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string'
}

function isErrorDetail(value: unknown): value is ODataErrorDetail {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.code) &&
    isNonEmptyString(value.message) &&
    isTarget(value.target)
  )
}

/** The serialized response of a mapper result, or the reason it is invalid. */
function fromMapping(mapping: unknown): ODataErrorResponse | string {
  if (!isPlainObject(mapping)) return 'it is not an object'
  const { status, code, message, target, details, innererror } = mapping
  if (!isErrorStatus(status)) {
    return 'status is not an integer from 400 to 599'
  }
  if (!isNonEmptyString(code) || !isNonEmptyString(message)) {
    return 'code and message must be non-empty strings'
  }
  if (!isTarget(target)) return 'target must be a string or null'
  if (details !== undefined && !(Array.isArray(details) && details.every(isErrorDetail))) {
    return 'details must be an array of { code, message, target? } with non-empty code and message'
  }
  if (innererror !== undefined && !isPlainObject(innererror)) {
    return 'innererror must be an object'
  }
  return {
    status,
    body: {
      error: {
        code,
        message,
        ...(target !== undefined ? { target } : {}),
        details: details ?? [],
        ...(innererror !== undefined ? { innererror } : {}),
      },
    },
  }
}

/** Run the mapper; any failure is logged and gives `undefined` (default mapping). */
function runMapper(
  mapper: ODataErrorMapper,
  exception: unknown,
  context: ODataErrorMapperContext,
): ODataErrorResponse | undefined {
  try {
    const mapping: unknown = mapper(exception, context)
    if (mapping === undefined || mapping === null) return undefined
    if (typeof (mapping as { then?: unknown }).then === 'function') {
      // Never leave a rejection unhandled; the result cannot be awaited by a sync filter.
      ;(mapping as Promise<unknown>).then(undefined, () => undefined)
      logger.warn('errorMapper returned a Promise; it must be synchronous. Using the default.')
      return undefined
    }
    const response = fromMapping(mapping)
    if (typeof response === 'string') {
      logger.warn(`errorMapper returned an invalid mapping (${response}). Using the default.`)
      return undefined
    }
    return response
  } catch (err) {
    logger.warn(
      `errorMapper threw (${err instanceof Error ? err.name : typeof err}). Using the default.`,
    )
    return undefined
  }
}

/**
 * Build the OData error response for an exception: the application's `errorMapper` first,
 * then the library's default mapping.
 */
export function buildODataErrorResponse(
  exception: unknown,
  mapper?: ODataErrorMapper,
  context: ODataErrorMapperContext = {},
): ODataErrorResponse {
  return (mapper && runMapper(mapper, exception, context)) ?? defaultErrorResponse(exception)
}
