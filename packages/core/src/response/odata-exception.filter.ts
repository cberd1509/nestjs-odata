import { ArgumentsHost, Catch, ExceptionFilter, Inject, Injectable, Optional } from '@nestjs/common'
import { ODATA_MODULE_OPTIONS } from '../tokens.js'
import type { ODataModuleResolvedOptions } from '../odata.module.js'
import { buildODataErrorResponse } from './odata-error.js'

/** Minimal shape of an HTTP response object (Express or Fastify compatible) */
interface HttpResponse {
  status(code: number): this
  json(body: unknown): this
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
    private readonly options?: Pick<ODataModuleResolvedOptions, 'errorMapper'>,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const response = http.getResponse<HttpResponse>()
    const { status, body } = buildODataErrorResponse(exception, this.options?.errorMapper, {
      host,
      request: http.getRequest?.(),
    })
    // A route may have set another Content-Type (e.g. text/plain on /$count) before failing.
    if (typeof response.setHeader === 'function') {
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
    } else if (typeof response.header === 'function') {
      response.header('Content-Type', 'application/json; charset=utf-8')
    }
    response.status(status).json(body)
  }
}
