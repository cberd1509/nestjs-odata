import { createParamDecorator } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'

/**
 * Parameter decorator that extracts req.query from the HTTP execution context.
 *
 * Usage:
 *   @Get()
 *   async getProducts(@ODataQueryParam('Products') query: ODataQuery) { ... }
 *
 * The decorator passes the entitySetName as `data` so that the ODataQueryPipe
 * can inject it into the query object for context URL construction and field validation.
 *
 * Per D-14: returns { query: req.query, entitySetName: data } so ODataQueryPipe
 * can extract both the raw query params and the entity set context.
 *
 * Zero TypeORM imports — per PKG-01 architecture constraint.
 */
export const ODataQueryParam = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ query: Record<string, string> }>()
    return { query: request.query, entitySetName: data }
  },
)
