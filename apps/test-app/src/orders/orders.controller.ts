import { Body, Get, Header, Headers, Param, Req, UsePipes } from '@nestjs/common'
import {
  ODataController,
  ODataGet,
  ODataGetByKey,
  ODataPost,
  ODataPatch,
  ODataPut,
  ODataDelete,
  ODataQueryParam,
  ODataQueryPipe,
  type ODataQuery,
} from '@nestjs-odata/core'
import { TypeOrmAutoHandler } from '@nestjs-odata/typeorm'

/**
 * OrdersController — demonstrates @ODataController + CRUD + PUT decorator pattern.
 *
 * @ODataController('Orders') sets the initial path to 'Orders'.
 * Patched via PATH_METADATA in OrdersModule to /odata/Orders.
 *
 * All methods delegate to TypeOrmAutoHandler for zero-boilerplate OData
 * query execution and CRUD operations including PUT full replacement.
 */
@ODataController('Orders')
export class OrdersController {
  constructor(private readonly handler: TypeOrmAutoHandler) {}

  /**
   * GET /odata/Orders
   */
  @ODataGet('Orders', { path: '' })
  @UsePipes(ODataQueryPipe)
  async getOrders(
    @ODataQueryParam('Orders') query: ODataQuery,
    @Req() req: { originalUrl: string },
  ) {
    return this.handler.handleGet(query, req.originalUrl)
  }

  /**
   * GET /odata/Orders/$count
   */
  @Get('$count')
  @Header('Content-Type', 'text/plain')
  @UsePipes(ODataQueryPipe)
  async count(@ODataQueryParam('Orders') query: ODataQuery): Promise<number> {
    return this.handler.handleCount(query)
  }

  /**
   * GET /odata/Orders/:key
   */
  @ODataGetByKey('Orders')
  async getOrder(@Param('key') key: string, @Headers('if-none-match') ifNoneMatch?: string) {
    return this.handler.handleGetByKey(key, 'Orders', ifNoneMatch)
  }

  /**
   * POST /odata/Orders
   */
  @ODataPost('Orders')
  async createOrder(@Body() body: Record<string, unknown>) {
    return this.handler.handleCreate(body, 'Orders')
  }

  /**
   * PATCH /odata/Orders/:key
   *
   * Merge-patch semantics — only provided fields updated.
   */
  @ODataPatch('Orders')
  async updateOrder(
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.handler.handleUpdate(key, body, 'Orders', ifMatch)
  }

  /**
   * PUT /odata/Orders/:key
   *
   * Full entity replacement — unspecified fields reset to column defaults.
   * Per OData v4 spec: all properties replaced, not just those in the body.
   */
  @ODataPut('Orders')
  async replaceOrder(
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.handler.handleReplace(key, body, 'Orders', ifMatch)
  }

  /**
   * DELETE /odata/Orders/:key
   */
  @ODataDelete('Orders')
  async deleteOrder(@Param('key') key: string, @Headers('if-match') ifMatch?: string) {
    return this.handler.handleDelete(key, 'Orders', ifMatch)
  }
}
