import { Injectable, Inject } from '@nestjs/common'
import { EdmRegistry } from '../edm/edm-registry.js'
import { ODATA_MODULE_OPTIONS } from '../tokens.js'
import type { ODataModuleOptions } from '../odata.module.js'

/** A single entity set entry in the OData service document */
export interface ServiceDocumentEntry {
  readonly name: string
  readonly url: string
  readonly kind: 'EntitySet'
}

/** OData service document response shape */
export interface ServiceDocument {
  readonly '@odata.context': string
  readonly value: readonly ServiceDocumentEntry[]
}

/**
 * ServiceDocumentBuilder — builds the OData service document (root URL response).
 *
 * Per D-24: Service document lists all registered EntitySets with name, url, and kind.
 */
@Injectable()
export class ServiceDocumentBuilder {
  constructor(
    private readonly edmRegistry: EdmRegistry,
    @Inject(ODATA_MODULE_OPTIONS) private readonly options: ODataModuleOptions,
  ) {}

  /**
   * Build the OData service document JSON object.
   * Returns @odata.context pointing to $metadata and a value array with all EntitySets.
   */
  buildServiceDocument(): ServiceDocument {
    const serviceRoot = this.options.serviceRoot
    const entitySets = Array.from(this.edmRegistry.getEntitySets().values())

    const value: ServiceDocumentEntry[] = entitySets.map((es) => ({
      name: es.name,
      url: es.name,
      kind: 'EntitySet',
    }))

    return {
      '@odata.context': `${serviceRoot}/$metadata`,
      value,
    }
  }
}
