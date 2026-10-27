import { HttpException, HttpStatus, InternalServerErrorException } from '@nestjs/common'
import { getODataBatchPart, getODataRequestContext, type EdmEntityType } from '@nestjs-odata/core'
import { getODataChangesetManager } from '../batch/changeset-context.js'
import type { ODataWriteContext, ODataWriteHandlers, ODataWriteOperation } from './write.types.js'

/**
 * True when a POST body is a deep insert: it carries a collection navigation property as an
 * array, or a single-valued one as an object. `null` and scalars are not deep.
 */
export function isDeepInsertBody(
  entityType: EdmEntityType,
  body: Record<string, unknown>,
): boolean {
  return entityType.navigationProperties.some((np) => {
    const value = body[np.name]
    return np.isCollection ? Array.isArray(value) : value !== null && typeof value === 'object'
  })
}

/**
 * 405 for an operation an entity set with write handlers does not implement. Carries the
 * methods the addressed resource does allow, for the `Allow` header that OData-Protocol 4.01
 * §9.2.2 requires on a 405.
 */
export class WriteNotAllowedException extends HttpException {
  constructor(
    entitySetName: string,
    operation: ODataWriteOperation,
    /** Value of the `Allow` response header, e.g. `GET, PATCH`. */
    readonly allow: string,
  ) {
    super(
      {
        error: {
          code: 'MethodNotAllowed',
          message: `Entity set '${entitySetName}' does not support ${operation}`,
        },
      },
      HttpStatus.METHOD_NOT_ALLOWED,
    )
  }
}

/**
 * The methods the write handlers allow on a resource: on the collection (`GET`, and `POST` with
 * `create` or `deepInsert`), or on one entity (`GET`, `PATCH`, `PUT`, `DELETE` as implemented).
 */
export function allowedMethods(
  handlers: ODataWriteHandlers<any>,
  resource: 'collection' | 'entity',
): string {
  const methods = ['GET']
  if (resource === 'collection') {
    if (handlers.create || handlers.deepInsert) methods.push('POST')
  } else {
    if (handlers.update) methods.push('PATCH')
    if (handlers.replace) methods.push('PUT')
    if (handlers.delete) methods.push('DELETE')
  }
  return methods.join(', ')
}

/** 405 for `operation` on an entity set with write handlers, with its `Allow` value. */
export function writeNotAllowed(
  entitySetName: string,
  operation: ODataWriteOperation,
  handlers: ODataWriteHandlers<any>,
): WriteNotAllowedException {
  const resource = operation === 'create' || operation === 'deepInsert' ? 'collection' : 'entity'
  return new WriteNotAllowedException(entitySetName, operation, allowedMethods(handlers, resource))
}

/**
 * A create, deep-insert, update or replace handler must return the entity to serialize. A
 * missing result is a bug in the handler: fail with 500 (rolling back a `$batch` changeset)
 * rather than answer with an empty or broken body.
 */
export function assertHandlerEntity(
  result: unknown,
  entitySetName: string,
  operation: ODataWriteOperation,
): Record<string, unknown> {
  if (result === null || typeof result !== 'object') {
    throw new InternalServerErrorException(
      `Write handler '${operation}' of entity set '${entitySetName}' returned no entity`,
    )
  }
  return result as Record<string, unknown>
}

/**
 * The handler a POST goes to: `deepInsert` for a deep-insert body when the entity set has one,
 * else `create`. Throws 405 when that handler is missing.
 */
export function createHandlerFor(
  handlers: ODataWriteHandlers<any>,
  entitySetName: string,
  entityType: EdmEntityType,
  body: Record<string, unknown>,
): {
  readonly operation: 'create' | 'deepInsert'
  readonly handler: NonNullable<ODataWriteHandlers<any>['create']>
} {
  const deep = handlers.deepInsert !== undefined && isDeepInsertBody(entityType, body)
  const operation = deep ? 'deepInsert' : 'create'
  const handler = deep ? handlers.deepInsert : handlers.create
  if (!handler) throw writeNotAllowed(entitySetName, operation, handlers)
  return { operation, handler }
}

/** The context handed to a write handler, with the current request's execution context. */
export function buildWriteContext(
  entitySetName: string,
  entityType: EdmEntityType,
  operation: ODataWriteOperation,
  extra: Partial<ODataWriteContext> = {},
): ODataWriteContext {
  const request = getODataRequestContext()
  // A `$batch` operation runs through its route: describe it, and inside a changeset hand the
  // handler the changeset's entity manager.
  const part = getODataBatchPart()
  const manager = getODataChangesetManager()
  return {
    entitySetName,
    entityType,
    operation,
    executionContext: request?.executionContext,
    request: request?.request,
    ...(manager ? { manager } : {}),
    ...(part ? { batch: { contentId: part.contentId, inChangeset: part.inChangeset } } : {}),
    ...extra,
  }
}
