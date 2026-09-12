import type { Kysely } from 'kysely';
import type { Database } from '../src/db/database.types';
import { AuditRepository } from '../src/audit/audit.repository';
import { ConsentNoticeService } from '../src/consent/consent-notice.service';
import { ConsentRepository } from '../src/consent/consent.repository';
import { ConsentService } from '../src/consent/consent.service';
import { DomainError } from '../src/common/domain-error';
import {
  createTestDb,
  publishConsentNotice,
  seedFixture,
  truncateAll,
  type Fixture,
} from './db-fixture';

const CORRELATION_ID = '4b7d2e1a-3c5f-4a8b-9d0e-1f2a3b4c5d6e';

/**
 * `requireActiveConsent` is the authorisation boundary every later phase calls before
 * touching clinical data. These tests pin its refusals, because a gate that returns the
 * wrong answer here means processing health data without a legal basis.
 */
describe('consent gate (integration)', () => {
  let db: Kysely<Database>;
  let service: ConsentService;
  let repository: ConsentRepository;
  let fx: Fixture;

  beforeAll(async () => {
    db = await createTestDb();
    const audit = new AuditRepository(db);
    repository = new ConsentRepository(db, audit);
    service = new ConsentService(db, repository, new ConsentNoticeService(db));
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAll(db);
    fx = await seedFixture(db);
    await db.deleteFrom('pre_checkin').execute();
    await db.deleteFrom('consent').execute();
  });

  const capture = (decision: 'GRANTED' | 'DECLINED') =>
    service.capture({
      hospitalId: fx.hospitalId,
      language: 'en',
      decision,
      captureMethod: 'KIOSK_TOUCH',
      kioskDeviceId: fx.kioskId,
      correlationId: CORRELATION_ID,
      actorId: 'kiosk:MK-OPD-01',
    });

  const expectCode = async (patientId: string, code: string): Promise<void> => {
    try {
      await service.requireActiveConsent(patientId, CORRELATION_ID);
      throw new Error(`expected ${code}`);
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe(code);
    }
  };

  it('allows clinical intake with an active grant', async () => {
    const consent = await capture('GRANTED');
    const active = await service.requireActiveConsent(consent.patient_id, CORRELATION_ID);
    expect(active.id).toBe(consent.id);
  });

  it('refuses a patient who was never asked', async () => {
    const patient = await db
      .insertInto('patient')
      .values({ hospital_id: fx.hospitalId, provisional: true })
      .returningAll()
      .executeTakeFirstOrThrow();

    await expectCode(patient.id, 'CONSENT_REQUIRED');
  });

  it('refuses a patient who declined', async () => {
    const consent = await capture('DECLINED');
    await expectCode(consent.patient_id, 'CONSENT_DECLINED');
  });

  it('refuses after the consent has lapsed', async () => {
    const consent = await capture('GRANTED');
    await db
      .updateTable('consent')
      .set({ state: 'EXPIRED' })
      .where('id', '=', consent.id)
      .execute();

    await expectCode(consent.patient_id, 'CONSENT_EXPIRED');
  });

  it('refuses after withdrawal', async () => {
    const consent = await capture('GRANTED');
    await repository.revoke(consent.id, CORRELATION_ID, 'patient');
    await expectCode(consent.patient_id, 'CONSENT_EXPIRED');
  });

  it('refuses once the validity window has passed, without needing a sweep to run', async () => {
    const consent = await capture('GRANTED');
    // Still GRANTED in the row; only the clock has moved. Expiry is evaluated against the
    // database clock, so a kiosk with a wrong system time cannot extend a consent.
    await db
      .updateTable('consent')
      .set({
        captured_at: new Date(Date.now() - 172_800_000),
        valid_until: new Date(Date.now() - 1_000),
      })
      .where('id', '=', consent.id)
      .execute();

    await expectCode(consent.patient_id, 'CONSENT_EXPIRED');
  });

  it('throws rather than returning false, so a forgotten check cannot pass silently', async () => {
    const patient = await db
      .insertInto('patient')
      .values({ hospital_id: fx.hospitalId, provisional: true })
      .returningAll()
      .executeTakeFirstOrThrow();

    await expect(service.requireActiveConsent(patient.id, CORRELATION_ID)).rejects.toThrow(
      DomainError,
    );
  });

  it('refuses to capture a decision in a language with no published notice', async () => {
    await db.deleteFrom('governance_version').execute();
    await expect(capture('GRANTED')).rejects.toThrow(DomainError);
  });

  it('records the notice version that was actually published', async () => {
    await db.deleteFrom('governance_version').execute();
    await publishConsentNotice(db, fx.hospitalId, 'en', 'v3.2');

    const consent = await capture('GRANTED');
    expect(consent.notice_version).toBe('v3.2');
  });

  it('uses the newest grant when a patient consents more than once', async () => {
    const first = await capture('GRANTED');
    await db
      .updateTable('consent')
      .set({ captured_at: new Date(Date.now() - 3_600_000) })
      .where('id', '=', first.id)
      .execute();

    const second = await service.capture({
      hospitalId: fx.hospitalId,
      language: 'en',
      decision: 'GRANTED',
      captureMethod: 'KIOSK_TOUCH',
      correlationId: CORRELATION_ID,
      actorId: 'kiosk:MK-OPD-01',
      patientId: first.patient_id,
    });

    const active = await service.requireActiveConsent(first.patient_id, CORRELATION_ID);
    expect(active.id).toBe(second.id);
  });
});
