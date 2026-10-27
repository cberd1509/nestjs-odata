import type { ODataScopeFn } from './scope.types.js'

/**
 * The row-level scopes of one application, keyed by OData entity set name.
 *
 * `ODataTypeOrmModule.forFeature()` can be imported many times; every import shares the
 * registry of its application (one per `EdmRegistry` instance) so that a scope registered in
 * one feature module also applies when another feature's entity set expands into it.
 */
export class ODataScopeRegistry {
  private static readonly byApplication = new WeakMap<object, ODataScopeRegistry>()

  private readonly scopes = new Map<
    string,
    { readonly fn: ODataScopeFn; readonly source: unknown }
  >()

  /** The registry shared by everything that uses `applicationKey` (the app's `EdmRegistry`). */
  static for(applicationKey: object): ODataScopeRegistry {
    let registry = ODataScopeRegistry.byApplication.get(applicationKey)
    if (!registry) {
      registry = new ODataScopeRegistry()
      ODataScopeRegistry.byApplication.set(applicationKey, registry)
    }
    return registry
  }

  /**
   * Register the scope of an entity set. `source` identifies the definition (the function or
   * class passed to `forFeature()`): registering the same source twice is a no-op, a different
   * one is a configuration error.
   */
  register(entitySetName: string, fn: ODataScopeFn, source: unknown): void {
    const existing = this.scopes.get(entitySetName)
    if (existing) {
      if (existing.source === source) return
      throw new Error(
        `ODataTypeOrmModule: entity set '${entitySetName}' has two different row-level scopes. ` +
          'Register its scope in one forFeature() call only.',
      )
    }
    this.scopes.set(entitySetName, { fn, source })
  }

  get(entitySetName: string): ODataScopeFn | undefined {
    return this.scopes.get(entitySetName)?.fn
  }

  has(entitySetName: string): boolean {
    return this.scopes.has(entitySetName)
  }
}
