import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { API_CONTRACT_VERSION } from '@medikiosk/api-contracts';

export interface LivenessResponse {
  readonly status: 'ok';
  readonly service: 'core_api';
  readonly contractVersion: string;
  readonly uptimeSeconds: number;
}

export interface ReadinessResponse {
  readonly status: 'ready' | 'degraded';
  readonly checks: Readonly<Record<string, 'ok' | 'unconfigured' | 'failing'>>;
}

/**
 * Health endpoints for the kiosk startup health check, load balancers and monitoring.
 * They deliberately expose no patient data and no configuration values.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Liveness probe — the process is up and serving.' })
  liveness(): LivenessResponse {
    return {
      status: 'ok',
      service: 'core_api',
      contractVersion: API_CONTRACT_VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  @Get('ready')
  @ApiOperation({
    summary:
      'Readiness probe — reports dependency status. Phase 2 adds real Postgres, Redis and object-store checks.',
  })
  readiness(): ReadinessResponse {
    // Phase 1 has no dependencies wired yet; they are reported as `unconfigured`
    // rather than `ok` so monitoring never mistakes a stub for a working dependency.
    const checks = {
      database: 'unconfigured',
      redis: 'unconfigured',
      objectStore: 'unconfigured',
      hisAdapter: 'unconfigured',
    } as const;

    return { status: 'degraded', checks };
  }
}
