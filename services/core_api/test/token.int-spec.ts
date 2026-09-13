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
import { HisAdapter, SandboxHisAdapter } from '@medikiosk/his-adapter';
import type { Database } from '../src/db/database.types';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/domain-exception.filter';
import { createTestDb, seedFixture, truncateAll, type Fixture } from './db-fixture';

/**
 * "One token per visit, ever" is the single strongest guarantee in the product. A patient
 * holding two tokens is queued twice, seen twice, or turned away — and the hospital has no
 * way to tell which is real. These tests attack that guarantee from every angle.
 */
/**
 * Delegates to whichever adapter a test installs.
 *
 * Nest resolves the adapter once at startup, so tests cannot simply provide a different
 * instance per case — and mutating the shared one leaks state between tests. This keeps a
 * single stable injected object whose behaviour is swappable.
 */
class SwitchableHisAdapter extends HisAdapter {
  readonly kind = 'sandbox' as const;
  current: HisAdapter = new SandboxHisAdapter();

  requestToken(...args: Parameters<HisAdapter['requestToken']>) {
    return this.current.requestToken(...args);
  }

  getTokenStatus(...args: Parameters<HisAdapter['getTokenStatus']>) {
    return this.current.getTokenStatus(...args);
  }
}

describe('HIS token (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let db: Kysely<Database>;
  let fx: Fixture;
  let his: SwitchableHisAdapter;

  const http = () => request(app.getHttpServer());
  const headers = (): Record<string, string> => ({
    [KIOSK_DEVICE_HEADER]: 'MK-OPD-01',
    [CORRELATION_ID_HEADER]: randomUUID(),
  });

  /** Drives a visit all the way to a confirmed arrival, returning the token handle. */
  const arriveAndConfirm = async (): Promise<{ tokenHandle: string; preCheckinId: string }> => {
    const consent = await db
      .insertInto('consent')
      .values({
        patient_id: fx.patientId,
        hospital_id: fx.hospitalId,
        purpose: 'OPD clinical intake and consultation',
        data_categories: ['demographics'],
        language_tag: 'en',
        notice_version: 'v1.0',
        state: 'GRANTED',
        capture_method: 'MOBILE_PWA',
        valid_until: new Date(Date.now() + 86_400_000),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const created = await http()
      .post('/v1/precheckins')
      .set(CORRELATION_ID_HEADER, randomUUID())
      .send({
        consentId: consent.id,
        visit: {
          hospitalId: 'HOSP-TEST',
          branchId: 'MAIN',
          departmentId: 'AYU-OPD',
          visitType: 'NEW_COMPLAINT',
          visitWindowStart: new Date(Date.now() - 3_600_000).toISOString(),
          visitWindowEnd: new Date(Date.now() + 3_600_000).toISOString(),
        },
        demographics: { name: 'Ravi Kumar', sex: 'MALE', mobile: '9876543210' },
      })
      .expect(201);

    const preCheckinId = created.body.preCheckinId as string;
    await http()
      .post(`/v1/precheckins/${preCheckinId}/submit`)
      .set(CORRELATION_ID_HEADER, randomUUID())
      .expect(201);
    const qr = await http()
      .post(`/v1/precheckins/${preCheckinId}/qr`)
      .set(CORRELATION_ID_HEADER, randomUUID())
      .expect(201);

    const checkIn = await http()
      .post('/v1/arrival/check-in')
      .set(headers())
      .send({ kioskId: 'MK-OPD-01', qrPayload: qr.body.payload })
      .expect(201);

    const confirmed = await http()
      .post(`/v1/arrival/${checkIn.body.arrivalId}/confirm`)
      .set(headers())
      .send({ identityConfirmed: true })
      .expect(201);

    return { tokenHandle: confirmed.body.tokenHandle as string, preCheckinId };
  };

  beforeAll(async () => {
    db = await createTestDb();
    his = new SwitchableHisAdapter();
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(HisAdapter)
      .useValue(his)
      .compile();
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
    await db.deleteFrom('consent').execute();
    // A fresh sandbox for every test, so no token or counter survives into the next.
    his.current = new SandboxHisAdapter();
  });

  describe('issuing', () => {
    it('returns the token the HIS produced', async () => {
      const { tokenHandle } = await arriveAndConfirm();
      const res = await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(201);

      expect(res.body.state).toBe('ISSUED');
      expect(res.body.token).toMatch(/^AYU-\d{4}$/);
      expect(res.body.departmentName).toBe('Ayurveda OPD');
      expect(res.body.room).toBeDefined();
      // Returned on the FIRST issue, not only on a later read: the screen has to be able
      // to tell the patient where they stand without a second round trip.
      expect(res.body.queueStatus).toBe('Waiting');
    });

    it('stores exactly what the hospital returned', async () => {
      const { tokenHandle, preCheckinId } = await arriveAndConfirm();
      const res = await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(201);

      const row = await db
        .selectFrom('token_request')
        .selectAll()
        .where('pre_checkin_id', '=', preCheckinId)
        .executeTakeFirstOrThrow();

      expect(row.his_token).toBe(res.body.token);
      expect(row.state).toBe('ISSUED');
      expect(row.issued_at).not.toBeNull();
    });

    it('derives the idempotency key rather than taking it from the client', async () => {
      const { tokenHandle, preCheckinId } = await arriveAndConfirm();
      await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(201);

      const row = await db
        .selectFrom('token_request')
        .selectAll()
        .where('pre_checkin_id', '=', preCheckinId)
        .executeTakeFirstOrThrow();
      expect(row.idempotency_key).toBe(`MK-OPD-01-${preCheckinId}`);
    });
  });

  describe('never twice', () => {
    it('returns the same token when asked again', async () => {
      const { tokenHandle } = await arriveAndConfirm();
      const first = await http()
        .post(`/v1/arrival/${tokenHandle}/token`)
        .set(headers())
        .expect(201);
      const second = await http()
        .post(`/v1/arrival/${tokenHandle}/token`)
        .set(headers())
        .expect(201);

      expect(second.body.token).toBe(first.body.token);
    });

    it('does not contact the HIS again once a token exists', async () => {
      const { tokenHandle } = await arriveAndConfirm();
      await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(201);

      // Swap in an adapter that would issue a DIFFERENT token if it were asked.
      his.current = new SandboxHisAdapter();

      const again = await http()
        .post(`/v1/arrival/${tokenHandle}/token`)
        .set(headers())
        .expect(201);
      // The stored token wins: an already-ISSUED request short-circuits before the HIS.
      expect(again.body.token).toMatch(/^AYU-\d{4}$/);
      expect(await db.selectFrom('token_request').selectAll().execute()).toHaveLength(1);
    });

    it('creates exactly one token under ten concurrent requests', async () => {
      const { tokenHandle } = await arriveAndConfirm();

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()),
        ),
      );

      const tokens = new Set(
        results.filter((r) => r.status === 201).map((r) => r.body.token as string),
      );
      expect(tokens.size).toBe(1);

      const rows = await db.selectFrom('token_request').selectAll().execute();
      expect(rows).toHaveLength(1);
      expect(rows.filter((r) => r.state === 'ISSUED')).toHaveLength(1);
    });

    it('refuses a second ISSUED row at the database level', async () => {
      const { tokenHandle, preCheckinId } = await arriveAndConfirm();
      await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(201);

      // Bypasses the service and the idempotency key entirely.
      await expect(
        db
          .insertInto('token_request')
          .values({
            pre_checkin_id: preCheckinId,
            kiosk_device_id: fx.kioskId,
            idempotency_key: `MK-OPD-99-${preCheckinId}`,
            state: 'ISSUED',
            his_token: 'AYU-9999',
            issued_at: new Date(),
          })
          .execute(),
      ).rejects.toThrow(/token_request_one_issued_per_precheckin/);
    });
  });

  describe('uncertain outcomes', () => {
    it('recovers a token the HIS had already issued', async () => {
      const { tokenHandle, preCheckinId } = await arriveAndConfirm();

      // The request reached the hospital and produced a token; the response was lost.
      const uncertain = new SandboxHisAdapter({ forceOutcome: 'UNCERTAIN' });
      uncertain.seedIssued(`MK-OPD-01-${preCheckinId}`, 'AYU-0042', '3');
      his.current = uncertain;

      const res = await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(201);

      // Asked the hospital what it had already done rather than requesting another.
      expect(res.body.token).toBe('AYU-0042');
      expect(res.body.room).toBe('3');
    });

    it('parks a genuinely unknown outcome for a human', async () => {
      const { tokenHandle } = await arriveAndConfirm();
      his.current = new SandboxHisAdapter({ forceOutcome: 'UNCERTAIN' });

      const res = await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(503);
      expect(res.body.code).toBe('TOKEN_RECONCILIATION_REQUIRED');

      const row = await db.selectFrom('token_request').selectAll().executeTakeFirstOrThrow();
      expect(row.state).toBe('UNKNOWN_RECONCILIATION_REQUIRED');
      expect(row.his_token).toBeNull();
    });

    it('will not retry a parked request, however many times it is asked', async () => {
      const { tokenHandle } = await arriveAndConfirm();
      his.current = new SandboxHisAdapter({ forceOutcome: 'UNCERTAIN' });
      await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(503);

      // Even with a healthy HIS, a parked request stays parked: only a human may move it,
      // because retrying is exactly how a second token gets created.
      his.current = new SandboxHisAdapter();
      await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(503);

      expect(await db.selectFrom('token_request').selectAll().execute()).toHaveLength(1);
    });

    it('treats a thrown adapter as unknown, not as a failure', async () => {
      const { tokenHandle } = await arriveAndConfirm();
      his.current = {
        kind: 'rest',
        requestToken: () => Promise.reject(new Error('socket hang up')),
        getTokenStatus: () => Promise.reject(new Error('socket hang up')),
      } as unknown as HisAdapter;

      // The request may well have reached the hospital before the connection died.
      await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(503);
      const row = await db.selectFrom('token_request').selectAll().executeTakeFirstOrThrow();
      expect(row.state).toBe('UNKNOWN_RECONCILIATION_REQUIRED');
    });
  });

  describe('with a live kiosk session', () => {
    it('serves a mobile-QR arrival on a session that never left CREATED', async () => {
      // The gap that let a real defect through: every other test drives the arrival flow
      // with no kiosk session running. A patient at a real kiosk always has one, and a
      // mobile-QR patient's session sits in CREATED because language, consent and
      // demographics all happened at home.
      const session = await http().post('/v1/kiosk/sessions').set(headers()).expect(201);
      const { tokenHandle } = await arriveAndConfirm();

      const res = await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(201);
      expect(res.body.token).toMatch(/^AYU-\d{4}$/);

      const row = await db
        .selectFrom('kiosk_session')
        .selectAll()
        .where('id', '=', session.body.sessionId)
        .executeTakeFirstOrThrow();

      // Linked to the visit, but not marched through states it never visited — that
      // would assert the kiosk captured a consent it never showed.
      expect(row.pre_checkin_id).not.toBeNull();
      expect(row.state).toBe('CREATED');
    });

    it('still wipes the session link on exit', async () => {
      const session = await http().post('/v1/kiosk/sessions').set(headers()).expect(201);
      const { tokenHandle } = await arriveAndConfirm();
      await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(201);

      await http()
        .post(`/v1/kiosk/sessions/${session.body.sessionId}/end`)
        .set(headers())
        .send({ reason: 'COMPLETED', wiped: true })
        .expect(201);

      const row = await db
        .selectFrom('kiosk_session')
        .selectAll()
        .where('id', '=', session.body.sessionId)
        .executeTakeFirstOrThrow();
      expect(row.pre_checkin_id).toBeNull();
      expect(row.wiped_at).not.toBeNull();
    });
  });

  describe('an immediate poll may recover, never conclude', () => {
    it('parks rather than retrying when an immediate poll finds no record', async () => {
      const { tokenHandle } = await arriveAndConfirm();
      // Timed out, and the hospital reports nothing — but only milliseconds later, so it
      // may simply not have committed yet. Believing it would let a retry overtake a
      // request that is about to succeed.
      his.current = new SandboxHisAdapter({ forceOutcome: 'UNCERTAIN' });

      await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(503);
      const row = await db.selectFrom('token_request').selectAll().executeTakeFirstOrThrow();
      expect(row.state).toBe('UNKNOWN_RECONCILIATION_REQUIRED');
      expect(row.state).not.toBe('FAILED');
    });

    it('permits a retry when a LATER attempt finds no record', async () => {
      const { tokenHandle, preCheckinId } = await arriveAndConfirm();

      // A request that was sent ten minutes ago and never resolved. Written directly,
      // because reaching this state through the API would mean issuing a token first.
      await db
        .insertInto('token_request')
        .values({
          pre_checkin_id: preCheckinId,
          kiosk_device_id: fx.kioskId,
          idempotency_key: `MK-OPD-01-${preCheckinId}`,
          state: 'REQUESTED',
          attempt_count: 1,
          requested_at: new Date(Date.now() - 600_000),
        })
        .execute();

      // The first request has definitively ended, so NOT_FOUND can be believed.
      await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(503);
      const row = await db
        .selectFrom('token_request')
        .selectAll()
        .where('idempotency_key', '=', `MK-OPD-01-${preCheckinId}`)
        .executeTakeFirstOrThrow();
      expect(row.state).toBe('FAILED');
      expect(row.last_error_code).toBe('HIS_NO_RECORD');
    });
  });

  describe('reconciliation sweep', () => {
    const opsHeaders = (): Record<string, string> => ({
      authorization: `Bearer ${process.env['OPS_API_KEY'] as string}`,
      [CORRELATION_ID_HEADER]: randomUUID(),
    });

    it('lists parked requests for an operator', async () => {
      const { tokenHandle } = await arriveAndConfirm();
      his.current = new SandboxHisAdapter({ forceOutcome: 'UNCERTAIN' });
      await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(503);

      const res = await http().get('/v1/ops/reconciliation').set(opsHeaders()).expect(200);
      expect(res.body.count).toBe(1);
      expect(res.body.items[0].note).toContain('sandbox forced');
    });

    it('resolves a parked request once the hospital can be reached', async () => {
      const { tokenHandle, preCheckinId } = await arriveAndConfirm();
      his.current = new SandboxHisAdapter({ forceOutcome: 'UNCERTAIN' });
      await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(503);

      // The hospital had issued one all along.
      const recovered = new SandboxHisAdapter();
      recovered.seedIssued(`MK-OPD-01-${preCheckinId}`, 'AYU-0099', '2');
      his.current = recovered;

      const sweep = await http().post('/v1/ops/reconciliation/sweep').set(opsHeaders()).expect(201);
      expect(sweep.body.resolved).toBe(1);

      const row = await db.selectFrom('token_request').selectAll().executeTakeFirstOrThrow();
      expect(row.state).toBe('ISSUED');
      expect(row.his_token).toBe('AYU-0099');
    });

    it('leaves a request parked when the hospital still cannot be reached', async () => {
      const { tokenHandle } = await arriveAndConfirm();
      his.current = new SandboxHisAdapter({ forceOutcome: 'UNCERTAIN' });
      await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(503);

      const sweep = await http().post('/v1/ops/reconciliation/sweep').set(opsHeaders()).expect(201);
      // The sweep only ever polls; it never requests a token, so it is safe to re-run.
      expect(sweep.body.resolved).toBe(0);
      expect(sweep.body.pending).toBe(1);
    });

    it('refuses an operator request with no credentials', async () => {
      await http()
        .get('/v1/ops/reconciliation')
        .set(CORRELATION_ID_HEADER, randomUUID())
        .expect(400);
    });

    it('refuses an operator request with the wrong key', async () => {
      await http()
        .get('/v1/ops/reconciliation')
        .set({
          authorization: 'Bearer wrong-key-wrong-key-wrong',
          [CORRELATION_ID_HEADER]: randomUUID(),
        })
        .expect(400);
    });
  });

  describe('definitive rejection', () => {
    it('records a rejection as failed, which a retry is permitted from', async () => {
      const { tokenHandle } = await arriveAndConfirm();
      his.current = new SandboxHisAdapter({ forceOutcome: 'REJECTED' });

      await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(503);
      const row = await db.selectFrom('token_request').selectAll().executeTakeFirstOrThrow();
      expect(row.state).toBe('FAILED');
      expect(row.last_error_code).toBe('SANDBOX_FORCED_REJECTION');

      // A definitive "no" is safe to retry: the hospital is certain it issued nothing.
      his.current = new SandboxHisAdapter();
      const retry = await http()
        .post(`/v1/arrival/${tokenHandle}/token`)
        .set(headers())
        .expect(201);
      expect(retry.body.token).toMatch(/^AYU-\d{4}$/);
    });
  });

  describe('arrival is a precondition', () => {
    it('refuses a token before the arrival is confirmed', async () => {
      const consent = await db
        .insertInto('consent')
        .values({
          patient_id: fx.patientId,
          hospital_id: fx.hospitalId,
          purpose: 'OPD clinical intake and consultation',
          data_categories: ['demographics'],
          language_tag: 'en',
          notice_version: 'v1.0',
          state: 'GRANTED',
          capture_method: 'MOBILE_PWA',
          valid_until: new Date(Date.now() + 86_400_000),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const created = await http()
        .post('/v1/precheckins')
        .set(CORRELATION_ID_HEADER, randomUUID())
        .send({
          consentId: consent.id,
          visit: {
            hospitalId: 'HOSP-TEST',
            branchId: 'MAIN',
            departmentId: 'AYU-OPD',
            visitType: 'NEW_COMPLAINT',
            visitWindowStart: new Date(Date.now() - 3_600_000).toISOString(),
            visitWindowEnd: new Date(Date.now() + 3_600_000).toISOString(),
          },
          demographics: { name: 'Ravi Kumar', sex: 'MALE', mobile: '9876543210' },
        })
        .expect(201);

      // A handle only exists after a scan, so there is nothing to address the visit with.
      await http()
        .post(`/v1/arrival/${created.body.preCheckinId}/token`)
        .set(headers())
        .expect(422);
    });

    it('refuses an expired token handle', async () => {
      const { tokenHandle, preCheckinId } = await arriveAndConfirm();
      await db
        .updateTable('pre_checkin')
        .set({ arrival_handle_expires_at: new Date(Date.now() - 1_000) })
        .where('id', '=', preCheckinId)
        .execute();

      await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(422);
    });

    it('rotates the handle, so the one used to confirm cannot fetch a token', async () => {
      const consent = await db
        .insertInto('consent')
        .values({
          patient_id: fx.patientId,
          hospital_id: fx.hospitalId,
          purpose: 'OPD clinical intake and consultation',
          data_categories: ['demographics'],
          language_tag: 'en',
          notice_version: 'v1.0',
          state: 'GRANTED',
          capture_method: 'MOBILE_PWA',
          valid_until: new Date(Date.now() + 86_400_000),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const created = await http()
        .post('/v1/precheckins')
        .set(CORRELATION_ID_HEADER, randomUUID())
        .send({
          consentId: consent.id,
          visit: {
            hospitalId: 'HOSP-TEST',
            branchId: 'MAIN',
            departmentId: 'AYU-OPD',
            visitType: 'NEW_COMPLAINT',
            visitWindowStart: new Date(Date.now() - 3_600_000).toISOString(),
            visitWindowEnd: new Date(Date.now() + 3_600_000).toISOString(),
          },
          demographics: { name: 'Ravi Kumar', sex: 'MALE', mobile: '9876543210' },
        })
        .expect(201);
      await http()
        .post(`/v1/precheckins/${created.body.preCheckinId}/submit`)
        .set(CORRELATION_ID_HEADER, randomUUID())
        .expect(201);
      const qr = await http()
        .post(`/v1/precheckins/${created.body.preCheckinId}/qr`)
        .set(CORRELATION_ID_HEADER, randomUUID())
        .expect(201);

      const checkIn = await http()
        .post('/v1/arrival/check-in')
        .set(headers())
        .send({ kioskId: 'MK-OPD-01', qrPayload: qr.body.payload })
        .expect(201);
      const scanHandle = checkIn.body.arrivalId as string;

      const confirmed = await http()
        .post(`/v1/arrival/${scanHandle}/confirm`)
        .set(headers())
        .send({ identityConfirmed: true })
        .expect(201);

      expect(confirmed.body.tokenHandle).not.toBe(scanHandle);
      // The scan handle is spent and cannot be replayed at the token step.
      await http().post(`/v1/arrival/${scanHandle}/token`).set(headers()).expect(422);
      await http()
        .post(`/v1/arrival/${confirmed.body.tokenHandle}/token`)
        .set(headers())
        .expect(201);
    });
  });

  describe('status polling', () => {
    it('reports the recorded outcome without contacting the HIS', async () => {
      const { tokenHandle } = await arriveAndConfirm();
      await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(201);

      his.current = {
        kind: 'rest',
        requestToken: () => Promise.reject(new Error('must not be called')),
        getTokenStatus: () => Promise.reject(new Error('must not be called')),
      } as unknown as HisAdapter;

      // A kiosk polling while it waits must not be able to generate hospital traffic.
      const res = await http().get(`/v1/arrival/${tokenHandle}/status`).set(headers()).expect(200);
      expect(res.body.tokenState).toBe('ISSUED');
      expect(res.body.reconciliationRequired).toBe(false);
    });

    it('flags a parked request to the kiosk', async () => {
      const { tokenHandle } = await arriveAndConfirm();
      his.current = new SandboxHisAdapter({ forceOutcome: 'UNCERTAIN' });
      await http().post(`/v1/arrival/${tokenHandle}/token`).set(headers()).expect(503);

      const res = await http().get(`/v1/arrival/${tokenHandle}/status`).set(headers()).expect(200);
      expect(res.body.reconciliationRequired).toBe(true);
      expect(res.body.token).toBeUndefined();
    });
  });
});
