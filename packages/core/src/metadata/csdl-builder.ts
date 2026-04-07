import { Injectable, Inject } from '@nestjs/common'
import { EdmRegistry } from '../edm/edm-registry.js'
import type { EdmEntityType } from '../edm/edm-entity-type.js'
import type { EdmEntitySet } from '../edm/edm-entity-set.js'
import type { EdmProperty, EdmNavigationProperty } from '../edm/edm-types.js'
import { ODATA_MODULE_OPTIONS } from '../tokens.js'
import type { ODataModuleOptions } from '../odata.module.js'

/**
 * CsdlBuilder — builds OData v4 CSDL XML from the EdmRegistry.
 *
 * Per D-17: XML is built once at init time and cached.
 * Per D-08: Default namespace is 'Default'.
 * Per D-09: Container name is 'Container'.
 * Per T-02-08: Caching mitigates DoS risk from repeated CSDL requests.
 */
@Injectable()
export class CsdlBuilder {
  private cachedXml: string | null = null

  constructor(
    private readonly edmRegistry: EdmRegistry,
    @Inject(ODATA_MODULE_OPTIONS) private readonly options: ODataModuleOptions,
  ) {}

  /**
   * Build and return the CSDL XML string.
   * Builds once on first call; returns cached string on subsequent calls.
   */
  buildCsdlXml(): string {
    if (this.cachedXml !== null) {
      return this.cachedXml
    }
    this.cachedXml = this.buildXml()
    return this.cachedXml
  }

  private buildXml(): string {
    const namespace = this.options.namespace ?? 'Default'
    const entityTypes = Array.from(this.edmRegistry.getEntityTypes().values())
    const entitySets = Array.from(this.edmRegistry.getEntitySets().values())

    const parts: string[] = []
    parts.push('<?xml version="1.0" encoding="UTF-8"?>')
    parts.push('<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">')
    parts.push('  <edmx:DataServices>')
    parts.push(
      `    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="${namespace}">`,
    )

    for (const entityType of entityTypes) {
      parts.push(this.buildEntityTypeXml(entityType))
    }

    parts.push('      <EntityContainer Name="Container">')
    for (const entitySet of entitySets) {
      parts.push(this.buildEntitySetXml(entitySet, namespace))
    }
    parts.push('      </EntityContainer>')
    parts.push('    </Schema>')
    parts.push('  </edmx:DataServices>')
    parts.push('</edmx:Edmx>')

    return parts.join('\n')
  }

  private buildEntityTypeXml(entityType: EdmEntityType): string {
    const lines: string[] = []
    lines.push(`      <EntityType Name="${entityType.name}">`)

    if (entityType.keyProperties.length > 0) {
      lines.push('        <Key>')
      for (const keyProp of entityType.keyProperties) {
        lines.push(`          <PropertyRef Name="${keyProp}"/>`)
      }
      lines.push('        </Key>')
    }

    for (const prop of entityType.properties) {
      lines.push(this.buildPropertyXml(prop))
    }

    for (const nav of entityType.navigationProperties) {
      lines.push(this.buildNavigationPropertyXml(nav))
    }

    lines.push('      </EntityType>')
    return lines.join('\n')
  }

  private buildPropertyXml(prop: EdmProperty): string {
    let xml = `        <Property Name="${prop.name}" Type="${prop.type}" Nullable="${prop.nullable}"`
    if (prop.precision !== undefined) {
      xml += ` Precision="${prop.precision}"`
    }
    if (prop.scale !== undefined) {
      xml += ` Scale="${prop.scale}"`
    }
    if (prop.maxLength !== undefined) {
      xml += ` MaxLength="${prop.maxLength}"`
    }
    xml += '/>'
    return xml
  }

  private buildNavigationPropertyXml(nav: EdmNavigationProperty): string {
    if (nav.isCollection) {
      // Collection navigation properties do not have Nullable attribute per OData spec
      return `        <NavigationProperty Name="${nav.name}" Type="${nav.type}"/>`
    }
    return `        <NavigationProperty Name="${nav.name}" Type="${nav.type}" Nullable="${nav.nullable}"/>`
  }

  private buildEntitySetXml(entitySet: EdmEntitySet, namespace: string): string {
    return `        <EntitySet Name="${entitySet.name}" EntityType="${namespace}.${entitySet.entityTypeName}"/>`
  }
}
