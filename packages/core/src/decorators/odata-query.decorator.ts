import { createParamDecorator } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'
import { ODataQueryPipe } from '../query/odata-query.pipe.js'

/**
 * Internal param decorator that extracts req.query from the HTTP execution context.
 * Not exported — consumers use the ODataQueryParam wrapper which auto-attaches ODataQueryPipe.
 */
const RawQuery = createParamDecorator((_data: string | undefined, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<{ query: Record<string, string> }>()
  return request.query
})

/**
 * Parameter decorator that extracts req.query and auto-applies ODataQueryPipe.
 *
 * Usage:
 *   @Get()
 *   async getProducts(@ODataQueryParam('Products') query: ODataQuery) { ... }
 *
 * The decorator passes the entitySetName as `data` so that the ODataQueryPipe
 * can inject it into the query object for context URL construction and field validation.
 *
 * Per D-04: auto-applies ODataQueryPipe — no @UsePipes(ODataQueryPipe) needed.
 * Per D-05: ODataQueryPipe remains exported for advanced use cases.
 * Per D-06: eliminates silent validation bypass when forgetting @UsePipes.
 *
 * NestJS resolves ODataQueryPipe from DI automatically when a class reference
 * is passed as the pipe argument to a createParamDecorator result.
 *
 * Zero TypeORM imports — per PKG-01 architecture constraint.
 */
export const ODataQueryParam = (entitySetName?: string): ParameterDecorator =>
  RawQuery(entitySetName, ODataQueryPipe)
