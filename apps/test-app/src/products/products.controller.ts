import { Body, Get, Header, Param, Req, UsePipes } from '@nestjs/common'
import {
  ODataController,
  ODataGet,
  ODataGetByKey,
  ODataPost,
  ODataPatch,
  ODataDelete,
  ODataQueryParam,
  ODataQueryPipe,
  type ODataQuery,
} from '@nestjs-odata/core'
import { TypeOrmAutoHandler } from '@nestjs-odata/typeorm'

/**
 * ProductsController — demonstrates @ODataController + CRUD decorator pattern.
 *
 * @ODataController('Products') sets the initial path to 'Products'.
 * ODataModule.forRoot({ controllers: [ProductsController] }) patches
 * PATH_METADATA to prepend serviceRoot, resulting in /odata/Products.
 *
 * All methods delegate to TypeOrmAutoHandler for zero-boilerplate OData
 * query execution and CRUD operations.
 */
@ODataController('Products')
export class ProductsController {
  constructor(private readonly handler: TypeOrmAutoHandler) {}

  /**
   * GET /odata/Products
   * GET /odata/Products?$filter=...&$select=...&$orderby=...&$top=...&$skip=...&$count=...
   *
   * Returns OData JSON envelope with @odata.context, value array, and optional
   * @odata.count / @odata.nextLink.
   */
  @ODataGet('Products', { path: '' })
  @UsePipes(ODataQueryPipe)
  async getProducts(
    @ODataQueryParam('Products') query: ODataQuery,
    @Req() req: { originalUrl: string },
  ) {
    return this.handler.handleGet(query, req.originalUrl)
  }

  /**
   * GET /odata/Products/$count
   *
   * Returns total count of matching products as plain integer (text/plain).
   * Strips pagination ($top/$skip) so count reflects total filter match.
   * Registered BEFORE :key route so NestJS matches $count before the wildcard.
   */
  @Get('$count')
  @Header('Content-Type', 'text/plain')
  @UsePipes(ODataQueryPipe)
  async count(@ODataQueryParam('Products') query: ODataQuery): Promise<number> {
    return this.handler.handleCount(query)
  }

  /**
   * GET /odata/Products/:key
   *
   * Returns single entity with @odata.context containing /$entity suffix.
   * Returns 404 if entity not found.
   */
  @ODataGetByKey('Products')
  async getProduct(@Param('key') key: string) {
    return this.handler.handleGetByKey(key, 'Products')
  }

  /**
   * POST /odata/Products
   *
   * Creates a new entity. Returns 201 Created with Location header and
   * the created entity in OData JSON envelope.
   */
  @ODataPost('Products')
  async createProduct(@Body() body: Record<string, unknown>) {
    return this.handler.handleCreate(body, 'Products')
  }

  /**
   * PATCH /odata/Products/:key
   *
   * Updates entity with merge-patch semantics (only provided fields updated).
   * Returns 200 with the updated entity. Returns 404 if entity not found.
   */
  @ODataPatch('Products')
  async updateProduct(@Param('key') key: string, @Body() body: Record<string, unknown>) {
    return this.handler.handleUpdate(key, body, 'Products')
  }

  /**
   * DELETE /odata/Products/:key
   *
   * Deletes entity. Returns 204 No Content.
   * Returns 404 if entity not found.
   */
  @ODataDelete('Products')
  async deleteProduct(@Param('key') key: string) {
    return this.handler.handleDelete(key, 'Products')
  }
}
