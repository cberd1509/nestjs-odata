import { Module } from '@nestjs/common'
import { BatchController } from './batch-controller.js'

/**
 * Declares {@link BatchController} once per application. Every
 * `ODataTypeOrmModule.forFeature()` imports this static module; Nest instantiates a static
 * module once, so a single `POST {serviceRoot}/$batch` route serves the entity sets of every
 * feature module.
 */
@Module({ controllers: [BatchController] })
export class ODataBatchModule {}
