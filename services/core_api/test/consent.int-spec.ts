import type { Kysely } from 'kysely';
import type { Database } from '../src/db/database.types';
import { AuditRepository } from '../src/audit/audit.repository';
import { ConsentRepository } from '../src/consent/consent.repository';
import { InvalidStateTransitionError } from '../src/state-machines';
import { createTestDb, seedFixture, truncateAll, type Fixture } from './db-fixture';

const CORRELATION_ID = '5a1c9f2e-8b3d-4c6a-9e0f-1d2b3c4d5e6f';

describe('consent (integration)', () => {
  let db: Kysely<Database>;
  let repo: ConsentRepository;
  let fx: Fixture;

  beforeAll(async () => {
    db = await createTestDb();
    repo = new ConsentRepository(db, new AuditRepository(db));
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAll(db);
    fx = await seedFixture(db);
    // The fixture's own consent would otherwise satisfy findActive.
    await db.deleteFrom('pre_checkin').execute();
    await db.deleteFrom('consent').execute();
  });

  const capture = (
    decision: 'GRANTED' | 'DECLINED',
    validUntil = new Date(Date.now() + 86_400_000),
  ) =>
    repo.capture({
      patientId: fx.patientId,
      hospitalId: fx.hospitalId,
      purpose: 'OPD clinical intake and consultation',
      dataCategories: ['demographics', 'clinical-history'],
      languageTag: 'hi',
      noticeVersion: 'v1.0',
      captureMethod: 'KIOSK_TOUCH',
      kioskDeviceId: fx.kioskId,
      validUntil,
      decision,
      correlationId: CORRELATION_ID,
      actorId: 'kiosk:MK-OPD-01',
    });

  it('stores a granted consent with the notice version the patient was shown', async () => {
    const consent = await capture('GRANTED');
    expect(consent.state).toBe('GRANTED');
    expect(consent.notice_version).toBe('v1.0');
    expect(consent.data_categories).toEqual(['demographics', 'clinical-history']);
  });

  it('records a decline rather than discarding it', async () => {
    const consent = await capture('DECLINED');
    expect(consent.state).toBe('DECLINED');
    // A declined consent never authorises processing.
    expect(await repo.findActive(fx.patientId)).toBeUndefined();
  });

  it('writes the consent and its audit event in the same transaction', async () => {
    const consent = await capture('GRANTED');

    const events = await db
      .selectFrom('audit_event')
      .selectAll()
      .where('entity_id', '=', consent.id)
      .execute();

    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('CONSENT_GRANTED');
    expect(events[0]?.correlation_id).toBe(CORRELATION_ID);
  });

  it('finds the active consent for a patient', async () => {
    const granted = await capture('GRANTED');
    expect((await repo.findActive(fx.patientId))?.id).toBe(granted.id);
  });

  it('does not treat a lapsed consent as active', async () => {
    await db
      .insertInto('consent')
      .values({
        patient_id: fx.patientId,
        hospital_id: fx.hospitalId,
        purpose: 'OPD clinical intake and consultation',
        data_categories: ['demographics'],
        language_tag: 'hi',
        notice_version: 'v1.0',
        state: 'GRANTED',
        capture_method: 'KIOSK_TOUCH',
        captured_at: new Date(Date.now() - 172_800_000),
        valid_until: new Date(Date.now() - 86_400_000),
      })
      .execute();

    expect(await repo.findActive(fx.patientId)).toBeUndefined();
  });

  it('revokes a granted consent and audits the withdrawal', async () => {
    const granted = await capture('GRANTED');
    const revoked = await repo.revoke(granted.id, CORRELATION_ID, 'patient');

    expect(revoked.state).toBe('REVOKED');
    expect(revoked.revoked_at).toBeInstanceOf(Date);
    expect(await repo.findActive(fx.patientId)).toBeUndefined();

    const actions = await db
      .selectFrom('audit_event')
      .select('action')
      .where('entity_id', '=', granted.id)
      .execute();
    expect(actions.map((a) => a.action)).toContain('CONSENT_REVOKED');
  });

  it('refuses to revoke a consent that was already declined', async () => {
    const declined = await capture('DECLINED');
    await expect(repo.revoke(declined.id, CORRELATION_ID, 'patient')).rejects.toThrow(
      InvalidStateTransitionError,
    );
  });

  it('marks lapsed consents expired', async () => {
    await db
      .insertInto('consent')
      .values({
        patient_id: fx.patientId,
        hospital_id: fx.hospitalId,
        purpose: 'OPD clinical intake and consultation',
        data_categories: ['demographics'],
        language_tag: 'hi',
        notice_version: 'v1.0',
        state: 'GRANTED',
        capture_method: 'KIOSK_TOUCH',
        captured_at: new Date(Date.now() - 172_800_000),
        valid_until: new Date(Date.now() - 1_000),
      })
      .execute();

    expect(await repo.expireLapsed()).toBe(1);
    const row = await db.selectFrom('consent').selectAll().executeTakeFirstOrThrow();
    expect(row.state).toBe('EXPIRED');
  });

  it('bumps the row version on every update, for optimistic concurrency', async () => {
    const granted = await capture('GRANTED');
    expect(granted.version).toBe(1);

    const revoked = await repo.revoke(granted.id, CORRELATION_ID, 'patient');
    expect(revoked.version).toBe(2);
  });

  it('refuses a validity window that ends before it starts', async () => {
    await expect(capture('GRANTED', new Date(Date.now() - 1_000))).rejects.toThrow(
      /consent_validity_window/,
    );
  });

  it('refuses a consent with no data categories', async () => {
    // cardinality(), not array_length(): array_length('{}', 1) is NULL and a NULL CHECK
    // passes, which would have let an empty, purpose-less consent through.
    await expect(
      db
        .insertInto('consent')
        .values({
          patient_id: fx.patientId,
          hospital_id: fx.hospitalId,
          purpose: 'OPD clinical intake and consultation',
          data_categories: [],
          language_tag: 'hi',
          notice_version: 'v1.0',
          capture_method: 'KIOSK_TOUCH',
          valid_until: new Date(Date.now() + 86_400_000),
        })
        .execute(),
    ).rejects.toThrow(/consent_has_data_category/);
  });
});
