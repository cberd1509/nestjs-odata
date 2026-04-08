import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'
import { ODataParseError } from '../parser/errors.js'
import { ODataValidationError } from '../query/odata-validation.error.js'

/** Minimal shape of an HTTP response object (Express or Fastify compatible) */
interface HttpResponse {
  status(code: number): this
  json(body: unknown): this
}

/**
 * OData v4 error response body shape (per OData v4 Part 1 section 9.4).
 */
interface ODataErrorBody {
  error: {
    code: string
    message: string
    details: unknown[]
  }
}

/**
 * NestJS exception filter that converts all caught exceptions into OData v4 error format.
 *
 * Per D-09: all errors are formatted as { error: { code, message, details } }.
 * Per D-11, T-03-08: never includes stack traces or internal server details.
 *
 * Handled exception types:
 *   - ODataParseError    -> HTTP 400, code 'BadRequest', user message
 *   - ODataValidationError -> HTTP 400, code 'BadRequest', user message
 *   - HttpException      -> uses exception's HTTP status code, generic OData code
 *   - All others         -> HTTP 500, code 'InternalServerError', generic message (no details leaked)
 *
 * Zero TypeORM imports — per PKG-01 architecture constraint.
 */
@Catch()
export class ODataExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<HttpResponse>()

    let status: number
    let body: ODataErrorBody

    if (exception instanceof ODataParseError) {
      status = HttpStatus.BAD_REQUEST
      const details: unknown[] = exception.queryContext ? [{ target: exception.queryContext }] : []
      body = {
        error: {
          code: 'BadRequest',
          message: exception.message,
          details,
        },
      }
    } else if (exception instanceof ODataValidationError) {
      status = HttpStatus.BAD_REQUEST
      const details: unknown[] =
        exception.availableProperties && exception.availableProperties.length > 0
          ? [{ target: 'availableProperties', value: [...exception.availableProperties] }]
          : []
      body = {
        error: {
          code: 'BadRequest',
          message: exception.message,
          details,
        },
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus()
      const code = httpStatusToODataCode(status)
      body = {
        error: {
          code,
          message: exception.message,
          details: [],
        },
      }
    } else {
      // Generic error — never leak internal details (T-03-08)
      status = HttpStatus.INTERNAL_SERVER_ERROR
      body = {
        error: {
          code: 'InternalServerError',
          message: 'An unexpected error occurred.',
          details: [],
        },
      }
    }

    response.status(status).json(body)
  }
}

/**
 * Map HTTP status code to an OData error code string.
 * Only covers the most common HTTP status codes.
 */
function httpStatusToODataCode(status: number): string {
  const codes: Record<number, string> = {
    400: 'BadRequest',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'NotFound',
    405: 'MethodNotAllowed',
    409: 'Conflict',
    410: 'Gone',
    422: 'UnprocessableEntity',
    429: 'TooManyRequests',
    500: 'InternalServerError',
    501: 'NotImplemented',
    503: 'ServiceUnavailable',
  }
  return codes[status] ?? 'Error'
}
