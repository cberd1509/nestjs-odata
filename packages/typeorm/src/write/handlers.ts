import { HttpException, HttpStatus, InternalServerErrorException } from '@nestjs/common'
import type { EdmEntityType } from '@nestjs-odata/core'
import type { ODataWriteHandlers, ODataWriteOperation } from './write.types.js'

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

/** 405 for an operation an entity set with write handlers does not implement. */
export function writeNotAllowed(
  entitySetName: string,
  operation: ODataWriteOperation,
): HttpException {
  return new HttpException(
    {
      error: {
        code: 'MethodNotAllowed',
        message: `Entity set '${entitySetName}' does not support ${operation}`,
      },
    },
    HttpStatus.METHOD_NOT_ALLOWED,
  )
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
  if (!handler) throw writeNotAllowed(entitySetName, operation)
  return { operation, handler }
}
