import { Test } from '@nestjs/testing';
import { API_CONTRACT_VERSION } from '@medikiosk/api-contracts';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
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

  it('reports unwired dependencies as unconfigured, never as ok', () => {
    const result = controller.readiness();
    expect(result.status).toBe('degraded');
    expect(Object.values(result.checks)).not.toContain('ok');
    expect(result.checks.database).toBe('unconfigured');
    expect(result.checks.hisAdapter).toBe('unconfigured');
  });
});
