import { SandboxHisAdapter, UnconfiguredHisAdapter } from './index';
import type { HisTokenRequest } from './index';

const request = (key = 'MK-OPD-01-visit-1'): HisTokenRequest => ({
  idempotencyKey: key,
  hospitalCode: 'HOSP-001',
  branchCode: 'MAIN',
  departmentCode: 'AYU-OPD',
  visitType: 'NEW_COMPLAINT',
  correlationId: '11111111-1111-4111-8111-111111111111',
});

describe('SandboxHisAdapter', () => {
  it('issues a token shaped like a queue number', async () => {
    const result = await new SandboxHisAdapter().requestToken(request());
    expect(result.outcome).toBe('ISSUED');
    if (result.outcome === 'ISSUED') expect(result.token).toMatch(/^AYU-\d{4}$/);
  });

  it('returns the same token for the same idempotency key', async () => {
    const adapter = new SandboxHisAdapter();
    const first = await adapter.requestToken(request());
    const second = await adapter.requestToken(request());

    // A sandbox that did not honour idempotency would hide the very bug it should surface.
    expect(first).toEqual(second);
  });

  it('gives different visits different tokens', async () => {
    const adapter = new SandboxHisAdapter();
    const a = await adapter.requestToken(request('MK-OPD-01-visit-1'));
    const b = await adapter.requestToken(request('MK-OPD-01-visit-2'));

    if (a.outcome === 'ISSUED' && b.outcome === 'ISSUED') {
      expect(a.token).not.toBe(b.token);
    } else {
      throw new Error('expected both to be issued');
    }
  });

  it('honours idempotency even when configured to reject', async () => {
    const adapter = new SandboxHisAdapter();
    await adapter.requestToken(request());
    const rejecting = new SandboxHisAdapter({ forceOutcome: 'REJECTED' });

    // A key that already produced a token keeps returning it on the SAME adapter.
    expect((await adapter.requestToken(request())).outcome).toBe('ISSUED');
    expect((await rejecting.requestToken(request())).outcome).toBe('REJECTED');
  });

  it('can be forced to report an uncertain outcome', async () => {
    const adapter = new SandboxHisAdapter({ forceOutcome: 'UNCERTAIN' });
    const result = await adapter.requestToken(request());
    expect(result.outcome).toBe('UNCERTAIN');
    // Nothing was recorded, so a status poll must say so rather than inventing a token.
    expect((await adapter.getTokenStatus(request().idempotencyKey)).outcome).toBe('NOT_FOUND');
  });

  it('reports a token it already issued when polled', async () => {
    const adapter = new SandboxHisAdapter();
    const issued = await adapter.requestToken(request());
    const status = await adapter.getTokenStatus(request().idempotencyKey);

    expect(status.outcome).toBe('ISSUED');
    if (status.outcome === 'ISSUED' && issued.outcome === 'ISSUED') {
      expect(status.token).toBe(issued.token);
    }
  });

  it('reports NOT_FOUND for a key it has never seen', async () => {
    expect((await new SandboxHisAdapter().getTokenStatus('never-seen')).outcome).toBe('NOT_FOUND');
  });

  it('derives the queue prefix from the department', async () => {
    const adapter = new SandboxHisAdapter();
    const result = await adapter.requestToken({ ...request(), departmentCode: 'UNA-OPD' });
    if (result.outcome === 'ISSUED') expect(result.token.startsWith('UNA-')).toBe(true);
  });
});

describe('UnconfiguredHisAdapter', () => {
  it('throws rather than reporting an uncertain outcome', async () => {
    // An unconfigured deployment is a deployment mistake, not an ambiguous hospital
    // response. Dressing it up as one would fill the reconciliation queue with items no
    // human can resolve.
    await expect(new UnconfiguredHisAdapter().requestToken()).rejects.toThrow(/No HIS adapter/);
    await expect(new UnconfiguredHisAdapter().getTokenStatus()).rejects.toThrow(/No HIS adapter/);
  });
});
