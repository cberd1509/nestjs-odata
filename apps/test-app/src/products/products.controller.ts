import { Controller, Get, Header, UsePipes } from '@nestjs/common'
import { ODataGet, ODataQueryParam, ODataQueryPipe } from '@nestjs-odata/core'
import type { ODataQuery, ODataQueryResult } from '@nestjs-odata/core'
import { TypeOrmAutoHandler } from '@nestjs-odata/typeorm'

/**
 * ProductsController — demonstrates @ODataGet() + @ODataQueryParam() pattern.
 *
 * Uses TypeOrmAutoHandler for zero-boilerplate OData query execution.
 * The $count route returns a plain integer (text/plain) per D-15.
 *
 * ODataQueryPipe is applied via @UsePipes() so it processes the raw req.query
 * object returned by @ODataQueryParam() into a typed, validated ODataQuery.
 */
@Controller('odata')
export class ProductsController {
  constructor(private readonly autoHandler: TypeOrmAutoHandler) {}

  /**
   * GET /odata/Products
   * GET /odata/Products?$filter=...&$select=...&$orderby=...&$top=...&$skip=...&$count=...
   *
   * Returns OData JSON envelope. @ODataGet() applies ODataResponseInterceptor
   * (wraps ODataQueryResult into { @odata.context, value, @odata.count?, @odata.nextLink? })
   * and ODataExceptionFilter (formats errors as OData v4 error bodies).
   */
  @ODataGet('Products')
  @UsePipes(ODataQueryPipe)
  async findAll(@ODataQueryParam('Products') query: ODataQuery): Promise<ODataQueryResult> {
    return this.autoHandler.handleGet(query, '/odata/Products')
  }

  /**
   * GET /odata/Products/$count
   *
   * Returns total count of matching products as plain integer (text/plain).
   * Strips pagination ($top/$skip) so count reflects total filter match, not page size.
   */
  @Get('Products/$count')
  @Header('Content-Type', 'text/plain')
  @UsePipes(ODataQueryPipe)
  async count(@ODataQueryParam('Products') query: ODataQuery): Promise<number> {
    return this.autoHandler.handleCount(query)
  }
}
