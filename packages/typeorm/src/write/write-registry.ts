import type { ODataETagSource, ODataWriteHandlers } from './write.types.js'

/**
 * Write handlers and ETag sources of one application, shared by every
 * `ODataTypeOrmModule.forFeature()` import (one registry per `EdmRegistry` instance).
 */
export class ODataWriteRegistry {
  private static readonly byApplication = new WeakMap<object, ODataWriteRegistry>()

  private readonly handlers = new Map<
    string,
    { readonly value: ODataWriteHandlers<any>; readonly source: unknown }
  >()
  private readonly etags = new Map<string, ODataETagSource>()
  private readonly requireIfMatch = new Set<string>()

  static for(applicationKey: object): ODataWriteRegistry {
    let registry = ODataWriteRegistry.byApplication.get(applicationKey)
    if (!registry) {
      registry = new ODataWriteRegistry()
      ODataWriteRegistry.byApplication.set(applicationKey, registry)
    }
    return registry
  }

  registerHandlers(
    entitySetName: string,
    handlers: ODataWriteHandlers<any>,
    source: unknown,
  ): void {
    const existing = this.handlers.get(entitySetName)
    if (existing) {
      if (existing.source === source) return
      throw new Error(
        `ODataTypeOrmModule: entity set '${entitySetName}' has two different write handlers. ` +
          'Register them in one forFeature() call only.',
      )
    }
    this.handlers.set(entitySetName, { value: handlers, source })
  }

  getHandlers(entitySetName: string): ODataWriteHandlers<any> | undefined {
    return this.handlers.get(entitySetName)?.value
  }

  registerETag(entitySetName: string, source: ODataETagSource): void {
    const existing = this.etags.get(entitySetName)
    if (existing !== undefined && existing !== source) {
      throw new Error(
        `ODataTypeOrmModule: entity set '${entitySetName}' has two different ETag sources`,
      )
    }
    this.etags.set(entitySetName, source)
  }

  getETag(entitySetName: string): ODataETagSource | undefined {
    return this.etags.get(entitySetName)
  }

  /** Make PATCH, PUT and DELETE on `entitySetName` require `If-Match` (428 otherwise). */
  registerRequireIfMatch(entitySetName: string): void {
    this.requireIfMatch.add(entitySetName)
  }

  /** Whether data modification requests on `entitySetName` require `If-Match`. */
  requiresIfMatch(entitySetName: string): boolean {
    return this.requireIfMatch.has(entitySetName)
  }
}
