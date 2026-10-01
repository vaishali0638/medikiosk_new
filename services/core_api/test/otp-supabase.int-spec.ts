import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { ConfigService } from '@nestjs/config';
import type { Database } from '../src/db/database.types';
import { AuditRepository } from '../src/audit/audit.repository';
import { OtpService } from '../src/identity/otp.service';
import type { SupabaseOtpTransport } from '../src/identity/supabase-otp.transport';
import { SandboxSmsAdapter } from '../src/sms/sms.adapter';
import { DomainError } from '../src/common/domain-error';
import type { Env } from '../src/config/env';
import { createTestDb, seedFixture, truncateAll, type Fixture } from './db-fixture';

/**
 * The Supabase verifier path.
 *
 * Supabase itself is stubbed — these tests are about what THIS service does with each
 * answer it gets back, which is the part a patient's lockout depends on. Whether Supabase
 * can deliver an SMS is not something a test suite can establish.
 */
describe('OTP via Supabase Auth (integration)', () => {
  let db: Kysely<Database>;
  let fx: Fixture;

  /** Records what the transport was asked, and answers however the test dictates. */
  class StubTransport {
    sendResult = true;
    verifyResult: 'verified' | 'rejected' | 'unavailable' = 'verified';
    sends: string[] = [];
    verifies: Array<{ mobile: string; code: string }> = [];

    async send(mobile: string): Promise<boolean> {
      this.sends.push(mobile);
      return this.sendResult;
    }

    async verify(mobile: string, code: string): Promise<'verified' | 'rejected' | 'unavailable'> {
      this.verifies.push({ mobile, code });
      return this.verifyResult;
    }
  }

  let transport: StubTransport;
  let service: OtpService;

  const config = {
    get: (key: keyof Env) => (key === 'OTP_PROVIDER' ? 'supabase' : undefined),
  } as unknown as ConfigService<Env, true>;

  const issue = async (mobile = '9876500001') =>
    service.issue({
      hospitalId: fx.hospitalId,
      mobile,
      purpose: 'EXISTING_PATIENT_LOOKUP',
      correlationId: randomUUID(),
      actorId: 'MK-OPD-01',
    });

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAll(db);
    fx = await seedFixture(db);
    transport = new StubTransport();
    service = new OtpService(
      db,
      new SandboxSmsAdapter(),
      new AuditRepository(db),
      config,
      transport as unknown as SupabaseOtpTransport,
    );
  });

  it('stores no hash, because it never saw the code', async () => {
    const issued = await issue();
    const row = await db
      .selectFrom('otp_verification')
      .select(['verifier', 'code_hash'])
      .where('id', '=', issued.verificationId)
      .executeTakeFirstOrThrow();

    expect(row.verifier).toBe('SUPABASE');
    // Not a hash of the empty string, and not a hash of anything else: empty. A stored
    // digest would imply this service could check the code, and it cannot.
    expect(row.code_hash).toBe('');
  });

  it('asks Supabase to send, and does not use the SMS gateway', async () => {
    await issue('9876500002');
    expect(transport.sends).toEqual(['9876500002']);
  });

  it('expires the row when Supabase will not send, rather than leaving it PENDING', async () => {
    transport.sendResult = false;
    await expect(issue()).rejects.toMatchObject({ code: 'OTP_SERVICE_UNAVAILABLE' });

    const rows = await db.selectFrom('otp_verification').select(['state']).execute();
    // A PENDING row for a code that was never sent asks the patient for something that
    // does not exist, and still counts against their send limit.
    expect(rows.map((r) => r.state)).toEqual(['EXPIRED']);
  });

  it('verifies when Supabase says the code is right', async () => {
    const issued = await issue();
    const row = await service.verify(issued.verificationId, '123456', randomUUID(), 'MK-OPD-01');
    expect(row.state).toBe('VERIFIED');
    expect(transport.verifies).toEqual([{ mobile: '9876500001', code: '123456' }]);
  });

  it('spends an attempt when Supabase rejects the code', async () => {
    const issued = await issue();
    transport.verifyResult = 'rejected';

    await expect(
      service.verify(issued.verificationId, '000000', randomUUID(), 'MK-OPD-01'),
    ).rejects.toBeInstanceOf(DomainError);

    const row = await db
      .selectFrom('otp_verification')
      .select(['attempt_count', 'state'])
      .where('id', '=', issued.verificationId)
      .executeTakeFirstOrThrow();
    expect(row.attempt_count).toBe(1);
    expect(row.state).toBe('PENDING');
  });

  it('locks after the allowance, exactly as the local path does', async () => {
    const issued = await issue();
    transport.verifyResult = 'rejected';

    for (let i = 0; i < 5; i += 1) {
      await expect(
        service.verify(issued.verificationId, '000000', randomUUID(), 'MK-OPD-01'),
      ).rejects.toBeInstanceOf(DomainError);
    }

    const row = await db
      .selectFrom('otp_verification')
      .select(['attempt_count', 'state'])
      .where('id', '=', issued.verificationId)
      .executeTakeFirstOrThrow();
    expect(row.state).toBe('LOCKED');
    expect(row.attempt_count).toBe(5);
  });

  it('does not spend an attempt when Supabase is unreachable', async () => {
    const issued = await issue();
    transport.verifyResult = 'unavailable';

    await expect(
      service.verify(issued.verificationId, '123456', randomUUID(), 'MK-OPD-01'),
    ).rejects.toMatchObject({ code: 'OTP_SERVICE_UNAVAILABLE' });

    const row = await db
      .selectFrom('otp_verification')
      .select(['attempt_count', 'state'])
      .where('id', '=', issued.verificationId)
      .executeTakeFirstOrThrow();
    // An outage is not a wrong guess. Charging the patient for it would lock them out of
    // a number they typed correctly.
    expect(row.attempt_count).toBe(0);
    expect(row.state).toBe('PENDING');
  });

  it('reports unavailable rather than rejecting when the transport is gone', async () => {
    const issued = await issue();
    // The deployment was switched back to local while this code was live.
    const withoutTransport = new OtpService(
      db,
      new SandboxSmsAdapter(),
      new AuditRepository(db),
      config,
      null,
    );

    await expect(
      withoutTransport.verify(issued.verificationId, '123456', randomUUID(), 'MK-OPD-01'),
    ).rejects.toMatchObject({ code: 'OTP_SERVICE_UNAVAILABLE' });
  });

  it('keeps the send-rate limit, which Supabase does not enforce for us', async () => {
    await issue();
    await issue();
    await issue();
    await expect(issue()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(transport.sends).toHaveLength(3);
  });

  it('records the send in the audit trail without the code', async () => {
    const issued = await issue();
    const events = await db
      .selectFrom('audit_event')
      .selectAll()
      .where('entity_id', '=', issued.verificationId)
      .execute();

    expect(events.map((e) => e.action)).toContain('OTP_SENT');
  });

  it('refuses a row that claims SUPABASE while holding a hash', async () => {
    // The constraint, not the application, is what makes the two impossible to mix up.
    await expect(
      db
        .insertInto('otp_verification')
        .values({
          hospital_id: fx.hospitalId,
          purpose: 'EXISTING_PATIENT_LOOKUP',
          mobile: '9876500009',
          code_hash: 'deadbeef',
          code_key_id: 'dev',
          verifier: 'SUPABASE',
          expires_at: new Date(Date.now() + 60_000),
        })
        .execute(),
    ).rejects.toThrow(/otp_verification_hash_matches_verifier/);
  });
});
