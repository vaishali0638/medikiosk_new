import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql } from 'kysely';
import { API_CONTRACT_VERSION } from '@medikiosk/api-contracts';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';

export interface LivenessResponse {
  readonly status: 'ok';
  readonly service: 'core_api';
  readonly contractVersion: string;
  readonly uptimeSeconds: number;
}

export type CheckState = 'ok' | 'unconfigured' | 'failing';

export interface ReadinessResponse {
  readonly status: 'ready' | 'degraded';
  readonly checks: Readonly<Record<string, CheckState>>;
}

/**
 * Health endpoints for the kiosk startup health check, load balancers and monitoring.
 * They deliberately expose no patient data and no configuration values.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

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
  @ApiOperation({ summary: 'Readiness probe — reports live dependency status.' })
  async readiness(): Promise<ReadinessResponse> {
    const checks: Record<string, CheckState> = {
      database: await this.checkDatabase(),
      // Not wired yet. Reported as `unconfigured` rather than `ok`, so monitoring is
      // never told a stub is a working dependency.
      redis: 'unconfigured',
      objectStore: 'unconfigured',
      hisAdapter: 'unconfigured',
    };

    const ready = Object.values(checks).every((state) => state === 'ok');
    return { status: ready ? 'ready' : 'degraded', checks };
  }

  /** Also verifies migrations have run: a reachable but unmigrated database is not ready. */
  private async checkDatabase(): Promise<CheckState> {
    try {
      await sql`SELECT 1 FROM schema_migrations LIMIT 1`.execute(this.db);
      return 'ok';
    } catch {
      return 'failing';
    }
  }
}
