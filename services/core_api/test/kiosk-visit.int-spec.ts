import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Kysely } from 'kysely';
import {
  API_BASE_PATH,
  CORRELATION_ID_HEADER,
  KIOSK_DEVICE_HEADER,
} from '@medikiosk/api-contracts';
import type { Database } from '../src/db/database.types';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/domain-exception.filter';
import { KioskVisitService } from '../src/kiosk/kiosk-visit.service';
import { createTestDb, seedFixture, truncateAll, type Fixture } from './db-fixture';

describe('opening a walk-in visit at the kiosk (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let db: Kysely<Database>;
  let fx: Fixture;
  let sessionId: string;

  const http = () => request(app.getHttpServer());
  const headers = (): Record<string, string> => ({
    [KIOSK_DEVICE_HEADER]: 'MK-OPD-01',
    [CORRELATION_ID_HEADER]: randomUUID(),
  });

  const openVisit = (departmentCode = 'AYU-OPD') =>
    http().post(`/v1/kiosk/sessions/${sessionId}/visit`).set(headers()).send({ departmentCode });

  /** Walks the session to the state the visit endpoint expects. */
  const confirmIdentity = async (): Promise<void> => {
    const consent = await db
      .selectFrom('consent')
      .select('patient_id')
      .where('patient_id', '=', fx.patientId)
      .executeTakeFirstOrThrow();

    for (const state of [
      'LANGUAGE_SELECTED',
      'CONSENT_PENDING',
      'CONSENT_GRANTED',
      'IDENTITY_PENDING',
    ] as const) {
      await db.updateTable('kiosk_session').set({ state }).where('id', '=', sessionId).execute();
    }
    await db
      .updateTable('kiosk_session')
      .set({ state: 'IDENTITY_CONFIRMED', patient_id: consent.patient_id })
      .where('id', '=', sessionId)
      .execute();
  };

  beforeAll(async () => {
    db = await createTestDb();
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix(API_BASE_PATH.replace(/^\//, ''), { exclude: ['health', 'health/ready'] });
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAll(db);
    fx = await seedFixture(db);
    await db.deleteFrom('pre_checkin').execute();

    const started = await http().post('/v1/kiosk/sessions').set(headers()).expect(201);
    sessionId = started.body.sessionId;
  });

  it('opens a visit for the confirmed patient on the session', async () => {
    await confirmIdentity();
    const res = await openVisit().expect(201);

    const row = await db
      .selectFrom('pre_checkin')
      .selectAll()
      .where('id', '=', res.body.preCheckinId)
      .executeTakeFirstOrThrow();

    expect(row.patient_id).toBe(fx.patientId);
    expect(row.kiosk_session_id).toBe(sessionId);
    expect(row.state).toBe('DRAFT');
  });

  it('moves the session into the interview', async () => {
    await confirmIdentity();
    await openVisit().expect(201);

    const session = await db
      .selectFrom('kiosk_session')
      .selectAll()
      .where('id', '=', sessionId)
      .executeTakeFirstOrThrow();
    expect(session.state).toBe('INTAKE_IN_PROGRESS');
  });

  it('is idempotent: a retry gets the visit that already exists', async () => {
    await confirmIdentity();
    const first = await openVisit().expect(201);
    const second = await openVisit().expect(201);

    expect(second.body.preCheckinId).toBe(first.body.preCheckinId);
    // Two visits for one person at one kiosk means two intakes and eventually two tokens.
    expect(await db.selectFrom('pre_checkin').selectAll().execute()).toHaveLength(1);
  });

  it('refuses before identity is confirmed', async () => {
    // Opening a visit for someone the kiosk has not finished identifying is how one
    // patient's intake ends up on another's record. 403 rather than 400: the session
    // carries no consented patient at all, which is a consent failure before it is a
    // malformed-request one.
    await openVisit().expect(403);
    expect(await db.selectFrom('pre_checkin').selectAll().execute()).toHaveLength(0);
  });

  it('refuses a department this kiosk does not stand outside of', async () => {
    await confirmIdentity();

    // A second branch, with its own department, that this kiosk has nothing to do with.
    const otherBranch = await db
      .insertInto('branch')
      .values({ hospital_id: fx.hospitalId, code: 'OTHER', name: 'Other branch' })
      .returningAll()
      .executeTakeFirstOrThrow();
    await db
      .insertInto('department')
      .values({
        branch_id: otherBranch.id,
        code: 'FAR-OPD',
        name: 'Distant OPD',
        ayush_system: 'UNANI',
      })
      .execute();

    await openVisit('FAR-OPD').expect(400);
  });

  it('refuses a disabled department', async () => {
    await confirmIdentity();
    await db
      .updateTable('department')
      .set({ enabled: false })
      .where('code', '=', 'AYU-OPD')
      .execute();

    await openVisit().expect(400);
  });

  it('refuses when consent has been withdrawn since it was granted', async () => {
    await confirmIdentity();
    await db
      .updateTable('consent')
      // `consent_revoked_state` will not accept a revocation without its timestamp.
      .set({ state: 'REVOKED', revoked_at: new Date() })
      .where('patient_id', '=', fx.patientId)
      .execute();

    await openVisit().expect(403);
    expect(await db.selectFrom('pre_checkin').selectAll().execute()).toHaveLength(0);
  });

  it('refuses to confirm arrival for a visit no kiosk opened', async () => {
    // SUBMITTED -> ARRIVAL_CONFIRMED exists for the walk-in, who never had a QR. On its
    // own that edge would let a mobile pre-check-in reach a token without ever being
    // scanned, so the service refuses any visit with no kiosk session behind it. This is
    // the test that the new edge did not weaken the property the machine is built around.
    const consent = await db.selectFrom('consent').select('id').executeTakeFirstOrThrow();

    const mobile = await db
      .insertInto('pre_checkin')
      .values({
        patient_id: fx.patientId,
        consent_id: consent.id,
        hospital_id: fx.hospitalId,
        branch_id: fx.branchId,
        department_id: fx.departmentId,
        visit_type: 'NEW_COMPLAINT',
        visit_window_start: new Date(Date.now() - 3_600_000),
        visit_window_end: new Date(Date.now() + 3_600_000),
        state: 'SUBMITTED',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const visits = moduleRef.get(KioskVisitService);
    await expect(
      visits.confirmWalkInArrival({
        preCheckinId: mobile.id,
        kioskDeviceId: fx.kioskId,
        correlationId: randomUUID(),
        actorId: 'kiosk:MK-OPD-01',
        handleTtlSeconds: 300,
      }),
    ).rejects.toThrow();

    const after = await db
      .selectFrom('pre_checkin')
      .select('state')
      .where('id', '=', mobile.id)
      .executeTakeFirstOrThrow();
    expect(after.state).toBe('SUBMITTED');
  });

  it('confirms arrival for a walk-in and rotates the handle on every use', async () => {
    await confirmIdentity();
    const opened = await openVisit().expect(201);

    const visits = moduleRef.get(KioskVisitService);
    const first = await visits.confirmWalkInArrival({
      preCheckinId: opened.body.preCheckinId,
      kioskDeviceId: fx.kioskId,
      correlationId: randomUUID(),
      actorId: 'kiosk:MK-OPD-01',
      handleTtlSeconds: 300,
    });
    const second = await visits.confirmWalkInArrival({
      preCheckinId: opened.body.preCheckinId,
      kioskDeviceId: fx.kioskId,
      correlationId: randomUUID(),
      actorId: 'kiosk:MK-OPD-01',
      handleTtlSeconds: 300,
    });

    // A handle rotates on every use, so one read off a screen cannot be replayed.
    expect(second).not.toBe(first);

    const row = await db
      .selectFrom('pre_checkin')
      .selectAll()
      .where('id', '=', opened.body.preCheckinId)
      .executeTakeFirstOrThrow();
    expect(row.state).toBe('ARRIVAL_CONFIRMED');
    expect(row.arrival_kiosk_id).toBe(fx.kioskId);
  });

  it('records the origin so a walk-in is distinguishable in the audit trail', async () => {
    await confirmIdentity();
    await openVisit().expect(201);

    const event = await db
      .selectFrom('audit_event')
      .selectAll()
      .where('action', '=', 'PRE_CHECKIN_CREATED')
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(event.detail)).toContain('KIOSK_WALK_IN');
  });
});
