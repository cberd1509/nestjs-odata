import { HttpException, HttpStatus } from '@nestjs/common'
import type { EdmEntityType } from '@nestjs-odata/core'

/** The write a body is prepared for. */
export type WriteBodyOperation = 'create' | 'update' | 'replace'

/**
 * Prepare a POST, PATCH or PUT body for the repository (OData-Protocol 4.01 §11.4.2, §11.4.3):
 *
 *   - computed properties (`Core.Computed`: timestamps, version, generated columns) are dropped:
 *     the service ignores the values clients send for them;
 *   - key properties are dropped on update and replace: the URL key identifies the row;
 *   - instance annotations and control information (`@odata.type`, `x@odata.bind`) are dropped;
 *   - a property that is neither a structural nor a navigation property of the entity type
 *     answers 400 Bad Request (the service MUST fail when it cannot persist a property), or is
 *     dropped when `ignoreUnknown` (the `ignoreUnknownProperties` module option) is set.
 *
 * Returns a new object; the body is never mutated.
 */
export function prepareWriteBody(
  entityType: EdmEntityType,
  body: Record<string, unknown>,
  operation: WriteBodyOperation,
  options: { readonly ignoreUnknown?: boolean } = {},
): Record<string, unknown> {
  const properties = new Map(entityType.properties.map((p) => [p.name, p]))
  const navigation = new Set(entityType.navigationProperties.map((n) => n.name))
  const keys = new Set(entityType.keyProperties)
  const prepared: Record<string, unknown> = {}
  const unknown: string[] = []

  for (const [name, value] of Object.entries(body)) {
    if (name.includes('@')) continue
    const property = properties.get(name)
    if (property) {
      if (property.computed) continue
      if (operation !== 'create' && keys.has(name)) continue
      prepared[name] = value
    } else if (navigation.has(name)) {
      prepared[name] = value
    } else if (!options.ignoreUnknown) {
      unknown.push(name)
    }
  }

  if (unknown.length > 0) {
    const list = unknown.map((n) => `'${n}'`).join(', ')
    throw new HttpException(
      {
        error: {
          code: 'BadRequest',
          message: `Entity type '${entityType.name}' has no propert${unknown.length === 1 ? 'y' : 'ies'} ${list}`,
          details: unknown.map((name) => ({
            code: 'UnknownProperty',
            message: `'${name}' is not a property of '${entityType.name}'`,
            target: name,
          })),
        },
      },
      HttpStatus.BAD_REQUEST,
    )
  }
  return prepared
}
