import { Body, Get, Header, Headers, Param, Req } from '@nestjs/common'
import {
  ODataController,
  ODataGet,
  ODataGetByKey,
  ODataPost,
  ODataPatch,
  ODataPut,
  ODataDelete,
  ODataQueryParam,
  type ODataQuery,
} from '@nestjs-odata/core'
import { TypeOrmAutoHandler } from '@nestjs-odata/typeorm'
import { DataSource } from 'typeorm'

/**
 * OrdersController — demonstrates @ODataController + CRUD + PUT decorator pattern.
 *
 * @ODataController('Orders') sets the initial path to 'Orders'.
 * ODataModule.forRoot({ controllers }) patches PATH_METADATA to /odata/Orders.
 *
 * All methods delegate to TypeOrmAutoHandler for zero-boilerplate OData
 * query execution and CRUD operations including PUT full replacement.
 */
@ODataController('Orders')
export class OrdersController {
  constructor(
    private readonly handler: TypeOrmAutoHandler,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * GET /odata/Orders
   */
  @ODataGet('Orders', { path: '' })
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
   *
   * Supports deep insert: if the body contains navigation property arrays (e.g. "items"),
   * creates the parent and all children atomically in a single transaction.
   * Falls back to handleCreate() when no navigation properties are present.
   */
  @ODataPost('Orders')
  async createOrder(@Body() body: Record<string, unknown>) {
    // Detect nested navigation property arrays
    const hasNavProps = Object.values(body).some(
      (v) => Array.isArray(v) && (v as unknown[]).length > 0,
    )

    if (!hasNavProps) {
      return this.handler.handleCreate(body, 'Orders')
    }

    // Deep insert: wrap in an explicit transaction
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    await queryRunner.startTransaction()
    try {
      const result = await this.handler.handleDeepCreate(body, 'Orders', queryRunner.manager)
      await queryRunner.commitTransaction()
      return result
    } catch (err) {
      await queryRunner.rollbackTransaction()
      throw err
    } finally {
      await queryRunner.release()
    }
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
