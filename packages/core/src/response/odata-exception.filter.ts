import { ArgumentsHost, Catch, ExceptionFilter, Inject, Injectable, Optional } from '@nestjs/common'
import { ODATA_MODULE_OPTIONS } from '../tokens.js'
import type { ODataModuleResolvedOptions } from '../odata.module.js'
import { buildODataErrorResponse } from './odata-error.js'
import { ODataEmptyResponse } from './odata-empty-response.js'

/** Minimal shape of an HTTP response object (Express or Fastify compatible) */
interface HttpResponse {
  status(code: number): this
  json(body: unknown): this
  /** Express (and Node) */
  end?(): unknown
  /** Fastify */
  send?(): unknown
  /** Express (and Node) */
  setHeader?(name: string, value: string): unknown
  /** Fastify */
  header?(name: string, value: string): unknown
}

/**
 * NestJS exception filter that converts all caught exceptions into OData v4 error format.
 *
 * Per D-09: all errors are formatted as { error: { code, message, details } }.
 * Per D-11, T-03-08: never includes stack traces or internal server details.
 *
 * The application's `errorMapper` (ODataModule.forRoot() option) runs first and may map any
 * exception to an OData error (code, message, status, target, details). When it returns
 * `undefined`, the default mapping applies:
 *   - ODataParseError    -> HTTP 400, code 'BadRequest', user message
 *   - ODataValidationError -> HTTP 400, code 'BadRequest', user message
 *   - HttpException      -> uses exception's HTTP status code, generic OData code
 *   - All others         -> HTTP 500, code 'InternalServerError', generic message (no details leaked)
 *
 * Every error response carries `Content-Language` (OData-Protocol 4.01 §9.4): the mapping's
 * `language`, else the `errorLanguage` module option, else `en`.
 *
 * It also answers the internal {@link ODataEmptyResponse} signal (304 Not Modified, 204 for
 * `Prefer: return=minimal`) with an empty response; that signal is not an error.
 *
 * Applied by the OData route decorators (`@ODataGet`, `@ODataPost`, …), to `$metadata` and to
 * `$batch`. Other routes, including plain Nest routes on an `@ODataController` class, keep the
 * application's own (global) filters; add `@UseFilters(ODataExceptionFilter)` to opt one in.
 *
 * Zero TypeORM imports — per PKG-01 architecture constraint.
 */
@Catch()
@Injectable()
export class ODataExceptionFilter implements ExceptionFilter {
  constructor(
    @Optional()
    @Inject(ODATA_MODULE_OPTIONS)
    private readonly options?: Partial<
      Pick<ODataModuleResolvedOptions, 'errorMapper' | 'errorLanguage'>
    >,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const response = http.getResponse<HttpResponse>()
    if (exception instanceof ODataEmptyResponse) {
      // Headers (ETag, Location, Preference-Applied, ...) were set before the signal was thrown.
      response.status(exception.status)
      if (typeof response.end === 'function') response.end()
      else response.send?.()
      return
    }
    const { status, body, language } = buildODataErrorResponse(
      exception,
      this.options?.errorMapper,
      { host, request: http.getRequest?.() },
      this.options?.errorLanguage,
    )
    // A route may have set another Content-Type (e.g. text/plain on /$count) before failing.
    setHeader(response, 'Content-Type', 'application/json; charset=utf-8')
    setHeader(response, 'Content-Language', language)
    response.status(status).json(body)
  }
}

function setHeader(response: HttpResponse, name: string, value: string): void {
  if (typeof response.setHeader === 'function') response.setHeader(name, value)
  else if (typeof response.header === 'function') response.header(name, value)
}
