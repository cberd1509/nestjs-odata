import { Controller, Get, Header, Inject } from '@nestjs/common'
import { CsdlBuilder } from './csdl-builder.js'
import { ServiceDocumentBuilder } from './service-document-builder.js'
import { ODATA_MODULE_OPTIONS } from '../tokens.js'
import type { ODataModuleOptions } from '../odata.module.js'

/**
 * MetadataController — serves the $metadata CSDL XML and OData service document.
 *
 * Routes (relative to serviceRoot, e.g. '/odata'):
 *   GET /odata/$metadata  → CSDL XML  (Content-Type: application/xml)
 *   GET /odata            → Service document JSON (Content-Type: application/json)
 *
 * The controller uses @Controller() with no prefix because consumers mount it
 * via ODataModule which sets the serviceRoot path. The routes use the serviceRoot
 * path directly to ensure correct routing when integrated into a NestJS app.
 *
 * Implementation uses a fixed serviceRoot-relative routing strategy:
 * The @Controller() prefix is set to the serviceRoot and endpoints are
 * '/$metadata' and '/' respectively. This is the most NestJS-idiomatic approach.
 */
@Controller()
export class MetadataController {
  constructor(
    private readonly csdlBuilder: CsdlBuilder,
    private readonly serviceDocumentBuilder: ServiceDocumentBuilder,
    @Inject(ODATA_MODULE_OPTIONS) readonly options: ODataModuleOptions,
  ) {}

  /**
   * GET {serviceRoot}/$metadata
   * Returns OData v4 CSDL XML document.
   * Content-Type: application/xml per OData spec.
   */
  @Get('$metadata')
  @Header('Content-Type', 'application/xml')
  getMetadata(): string {
    return this.csdlBuilder.buildCsdlXml()
  }

  /**
   * GET {serviceRoot}/ (service document)
   * Returns OData service document listing all available EntitySets.
   * Content-Type: application/json per OData spec.
   */
  @Get('')
  @Header('Content-Type', 'application/json')
  getServiceDocument(): object {
    return this.serviceDocumentBuilder.buildServiceDocument()
  }
}
