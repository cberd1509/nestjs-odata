import { Module } from '@nestjs/common'
import { HealthController } from './health.controller.js'

/**
 * HealthModule — plain NestJS module for non-OData route isolation testing.
 *
 * Registers HealthController without any OData module imports, confirming
 * that OData formatting does not leak to non-OData routes (MOD-05).
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
