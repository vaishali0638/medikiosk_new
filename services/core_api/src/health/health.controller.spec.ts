import { Test } from '@nestjs/testing';
import { API_CONTRACT_VERSION } from '@medikiosk/api-contracts';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    // A database stub that always fails, so readiness is exercised without a live server.
    const db = {} as Db;
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DB, useValue: db }],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('reports liveness with the contract version the kiosk can check against', () => {
    const result = controller.liveness();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('core_api');
    expect(result.contractVersion).toBe(API_CONTRACT_VERSION);
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('reports unwired dependencies as unconfigured, never as ok', async () => {
    const result = await controller.readiness();
    expect(result.status).toBe('degraded');
    expect(result.checks['redis']).toBe('unconfigured');
    expect(result.checks['objectStore']).toBe('unconfigured');
    expect(result.checks['hisAdapter']).toBe('unconfigured');
  });

  it('reports an unreachable database as failing, not as unconfigured', async () => {
    const result = await controller.readiness();
    expect(result.checks['database']).toBe('failing');
    expect(result.status).toBe('degraded');
  });
});
