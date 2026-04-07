import { Controller, Get } from '@nestjs/common'

/**
 * Non-OData controller for testing route isolation (RESP-03, MOD-05).
 *
 * This controller uses plain @Controller — its responses must NOT
 * be wrapped in OData JSON envelope. Validates that ODataResponseInterceptor
 * only activates on routes with ODATA_ROUTE_KEY metadata.
 *
 * Per T-04-14: /api/health must NOT have @odata.context in response.
 */
@Controller('api')
export class HealthController {
  @Get('health')
  getHealth() {
    return { status: 'ok', timestamp: new Date().toISOString() }
  }
}
