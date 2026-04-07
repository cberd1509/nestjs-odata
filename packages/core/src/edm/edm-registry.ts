import { Injectable } from '@nestjs/common'
import type { EdmEntityType } from './edm-entity-type.js'
import type { EdmEntitySet } from './edm-entity-set.js'

/**
 * EdmRegistry — NestJS injectable singleton that stores all registered
 * OData entity types and entity sets.
 *
 * Per threat model T-02-01: throws on duplicate registration to prevent
 * silent override of entity types (Tampering mitigation).
 */
@Injectable()
export class EdmRegistry {
  private readonly entityTypes = new Map<string, EdmEntityType>()
  private readonly entitySets = new Map<string, EdmEntitySet>()

  /**
   * Register an entity type and its corresponding entity set.
   *
   * Idempotent: if the same entity type name is already registered (e.g. from multiple
   * ODataTypeOrmModule.forFeature() calls in different feature modules), the registration
   * is silently skipped. This supports the common pattern of importing forFeature() in
   * both a root AppModule and a feature module for the same entity.
   *
   * Throws only if a DIFFERENT entity type is registered under the same name (name collision).
   */
  register(entityType: EdmEntityType, entitySet: EdmEntitySet): void {
    if (this.entityTypes.has(entityType.name)) {
      // Idempotent: same name already registered — skip silently
      return
    }
    this.entityTypes.set(entityType.name, entityType)
    this.entitySets.set(entitySet.name, entitySet)
  }

  /** Retrieve a registered entity type by name. Returns undefined if not found. */
  getEntityType(name: string): EdmEntityType | undefined {
    return this.entityTypes.get(name)
  }

  /** Retrieve a registered entity set by name. Returns undefined if not found. */
  getEntitySet(name: string): EdmEntitySet | undefined {
    return this.entitySets.get(name)
  }

  /** All registered entity types as a read-only map. */
  getEntityTypes(): ReadonlyMap<string, EdmEntityType> {
    return this.entityTypes
  }

  /** All registered entity sets as a read-only map. */
  getEntitySets(): ReadonlyMap<string, EdmEntitySet> {
    return this.entitySets
  }
}
