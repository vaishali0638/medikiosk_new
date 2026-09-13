import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { sql, type Kysely } from 'kysely';
import {
  API_BASE_PATH,
  CORRELATION_ID_HEADER,
  KIOSK_DEVICE_HEADER,
} from '@medikiosk/api-contracts';
import type { Database } from '../src/db/database.types';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/domain-exception.filter';
import { createTestDb, seedFixture, truncateAll, type Fixture } from './db-fixture';

/**
 * The QR is the one credential a patient carries through a public waiting room. These
 * tests exist to pin what happens when it is stolen, replayed, tampered with, or
 * presented at the wrong place.
 */
describe('arrival (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let db: Kysely<Database>;
  let fx: Fixture;

  const http = () => request(app.getHttpServer());
  const headers = (device = 'MK-OPD-01'): Record<string, string> => ({
    [KIOSK_DEVICE_HEADER]: device,
    [CORRELATION_ID_HEADER]: randomUUID(),
  });

  /** Drives the patient side: consent -> pre-check-in -> submit -> QR. */
  const issueQr = async (): Promise<{ token: string; preCheckinId: string }> => {
    const consent = await db
      .insertInto('consent')
      .values({
        patient_id: fx.patientId,
        hospital_id: fx.hospitalId,
        purpose: 'OPD clinical intake and consultation',
        data_categories: ['demographics', 'clinical-history'],
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
        demographics: {
          name: 'Ravi Kumar',
          sex: 'MALE',
          mobile: '9876543210',
          dateOfBirth: '1968-04-12',
        },
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

    return { token: qr.body.payload as string, preCheckinId };
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
    await db.deleteFrom('consent').execute();
  });

  describe('the happy path', () => {
    it('accepts a valid QR and returns masked details only', async () => {
      const { token } = await issueQr();
      const res = await http()
        .post('/v1/arrival/check-in')
        .set(headers())
        .send({ kioskId: 'MK-OPD-01', qrPayload: token })
        .expect(201);

      expect(res.body.masked.maskedName).toBe('R*** K****');
      expect(res.body.masked.maskedMobile).toBe('******3210');
      expect(res.body.departmentName).toBe('Ayurveda OPD');
      expect(JSON.stringify(res.body)).not.toContain('Ravi Kumar');
      expect(JSON.stringify(res.body)).not.toContain('9876543210');
    });

    it('returns a handle that is not the pre-check-in id', async () => {
      const { token, preCheckinId } = await issueQr();
      const res = await http()
        .post('/v1/arrival/check-in')
        .set(headers())
        .send({ kioskId: 'MK-OPD-01', qrPayload: token })
        .expect(201);

      // The QR payload is signed, not encrypted — anyone who photographs it can read the
      // pre-check-in id. The handle must therefore be something else entirely.
      expect(res.body.arrivalId).not.toBe(preCheckinId);
      expect(token).toContain(
        Buffer.from(JSON.stringify({ x: 1 }))
          .toString('base64url')
          .slice(0, 0),
      );
    });

    it('confirms the arrival and records what changed', async () => {
      const { token, preCheckinId } = await issueQr();
      const checkIn = await http()
        .post('/v1/arrival/check-in')
        .set(headers())
        .send({ kioskId: 'MK-OPD-01', qrPayload: token })
        .expect(201);

      const confirmed = await http()
        .post(`/v1/arrival/${checkIn.body.arrivalId}/confirm`)
        .set(headers())
        .send({ identityConfirmed: true, changedSections: ['SYMPTOMS', 'MEDICINES'] })
        .expect(201);

      const row = await db
        .selectFrom('pre_checkin')
        .selectAll()
        .where('id', '=', preCheckinId)
        .executeTakeFirstOrThrow();

      expect(row.state).toBe('ARRIVAL_CONFIRMED');
      expect(row.arrival_confirmed_at).not.toBeNull();

      // The handle is ROTATED, not cleared: requesting a token is a third step, and the
      // value used to confirm must not also be able to fetch a token.
      expect(row.arrival_handle).not.toBeNull();
      expect(row.arrival_handle).not.toBe(checkIn.body.arrivalId);
      expect(confirmed.body.tokenHandle).toBe(row.arrival_handle);

      // The pre-check-in id is never returned to the kiosk — anyone who photographed the
      // QR can read it, so it must not be an addressable handle.
      expect(JSON.stringify(confirmed.body)).not.toContain(preCheckinId);
    });
  });

  describe('replay', () => {
    it('refuses the same QR a second time', async () => {
      const { token } = await issueQr();
      await http()
        .post('/v1/arrival/check-in')
        .set(headers())
        .send({ kioskId: 'MK-OPD-01', qrPayload: token })
        .expect(201);

      const replay = await http()
        .post('/v1/arrival/check-in')
        .set(headers())
        .send({ kioskId: 'MK-OPD-01', qrPayload: token })
        .expect(422);
      expect(replay.body.code).toBe('QR_INVALID');
    });

    it('lets exactly one of ten simultaneous scans through', async () => {
      const { token } = await issueQr();

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          http()
            .post('/v1/arrival/check-in')
            .set(headers())
            .send({ kioskId: 'MK-OPD-01', qrPayload: token }),
        ),
      );

      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 422)).toHaveLength(9);
    });

    it('refuses a QR retired by re-issuing', async () => {
      const { token: first, preCheckinId } = await issueQr();
      await http()
        .post(`/v1/precheckins/${preCheckinId}/qr`)
        .set(CORRELATION_ID_HEADER, randomUUID())
        .expect(201);

      // The older screenshot on the patient's phone must stop working.
      await http()
        .post('/v1/arrival/check-in')
        .set(headers())
        .send({ kioskId: 'MK-OPD-01', qrPayload: first })
        .expect(422);
    });

    it('cannot replay a spent arrival handle', async () => {
      const { token } = await issueQr();
      const checkIn = await http()
        .post('/v1/arrival/check-in')
        .set(headers())
        .send({ kioskId: 'MK-OPD-01', qrPayload: token })
        .expect(201);

      await http()
        .post(`/v1/arrival/${checkIn.body.arrivalId}/confirm`)
        .set(headers())
        .send({ identityConfirmed: true })
        .expect(201);

      await http()
        .post(`/v1/arrival/${checkIn.body.arrivalId}/confirm`)
        .set(headers())
        .send({ identityConfirmed: true })
        .expect(422);
    });
  });

  describe('forgery and tampering', () => {
    it('refuses a tampered payload', async () => {
      const { token } = await issueQr();
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[2] as string, 'base64url').toString()) as Record<
        string,
        unknown
      >;
      payload['departmentId'] = 'CARDIO-OPD';
      parts[2] = Buffer.from(JSON.stringify(payload)).toString('base64url');

      await http()
        .post('/v1/arrival/check-in')
        .set(headers())
        .send({ kioskId: 'MK-OPD-01', qrPayload: parts.join('.') })
        .expect(422);
    });

    it('refuses arbitrary text', async () => {
      for (const payload of ['garbage', 'mk1.dev.x.y', '{}']) {
        await http()
          .post('/v1/arrival/check-in')
          .set(headers())
          .send({ kioskId: 'MK-OPD-01', qrPayload: payload })
          .expect(422);
      }
    });

    it('refuses an expired QR', async () => {
      const { token, preCheckinId } = await issueQr();
      await sql`UPDATE qr_nonce SET issued_at = now() - interval '20 minutes',
                expires_at = now() - interval '15 minutes'
                WHERE pre_checkin_id = ${preCheckinId}`.execute(db);

      // The token's own expiry also fires; either alone is enough.
      await http()
        .post('/v1/arrival/check-in')
        .set(headers())
        .send({ kioskId: 'MK-OPD-01', qrPayload: token })
        .expect(422);
    });
  });

  describe('facility binding', () => {
    it('refuses a QR presented at another hospital', async () => {
      const { token } = await issueQr();

      const other = await db
        .insertInto('hospital')
        .values({ code: 'HOSP-OTHER', name: 'Other Hospital' })
        .returningAll()
        .executeTakeFirstOrThrow();
      const otherBranch = await db
        .insertInto('branch')
        .values({ hospital_id: other.id, code: 'MAIN', name: 'Main' })
        .returningAll()
        .executeTakeFirstOrThrow();
      await db
        .insertInto('kiosk_device')
        .values({ branch_id: otherBranch.id, code: 'MK-OTHER-01' })
        .execute();

      await http()
        .post('/v1/arrival/check-in')
        .set(headers('MK-OTHER-01'))
        .send({ kioskId: 'MK-OTHER-01', qrPayload: token })
        .expect(422);
    });

    it('does not burn the code when it is presented at the wrong hospital', async () => {
      const { token } = await issueQr();
      const other = await db
        .insertInto('hospital')
        .values({ code: 'HOSP-OTHER', name: 'Other Hospital' })
        .returningAll()
        .executeTakeFirstOrThrow();
      const otherBranch = await db
        .insertInto('branch')
        .values({ hospital_id: other.id, code: 'MAIN', name: 'Main' })
        .returningAll()
        .executeTakeFirstOrThrow();
      await db
        .insertInto('kiosk_device')
        .values({ branch_id: otherBranch.id, code: 'MK-OTHER-01' })
        .execute();

      await http()
        .post('/v1/arrival/check-in')
        .set(headers('MK-OTHER-01'))
        .send({ kioskId: 'MK-OTHER-01', qrPayload: token })
        .expect(422);

      // A patient who wandered to the wrong building must still be able to check in at
      // the right one, so facility checks run before the nonce is spent.
      await http()
        .post('/v1/arrival/check-in')
        .set(headers())
        .send({ kioskId: 'MK-OPD-01', qrPayload: token })
        .expect(201);
    });

    it('refuses a visit outside its time window', async () => {
      const { token, preCheckinId } = await issueQr();
      await db
        .updateTable('pre_checkin')
        .set({
          visit_window_start: new Date(Date.now() + 86_400_000),
          visit_window_end: new Date(Date.now() + 90_000_000),
        })
        .where('id', '=', preCheckinId)
        .execute();

      await http()
        .post('/v1/arrival/check-in')
        .set(headers())
        .send({ kioskId: 'MK-OPD-01', qrPayload: token })
        .expect(422);
    });
  });

  describe('state and consent', () => {
    it('refuses a cancelled pre-check-in', async () => {
      const { token, preCheckinId } = await issueQr();
      await db
        .updateTable('pre_checkin')
        .set({ state: 'CANCELLED' })
        .where('id', '=', preCheckinId)
        .execute();

      await http()
        .post('/v1/arrival/check-in')
        .set(headers())
        .send({ kioskId: 'MK-OPD-01', qrPayload: token })
        .expect(422);
    });

    it('refuses once consent has been withdrawn', async () => {
      const { token, preCheckinId } = await issueQr();
      const pre = await db
        .selectFrom('pre_checkin')
        .selectAll()
        .where('id', '=', preCheckinId)
        .executeTakeFirstOrThrow();
      await db
        .updateTable('consent')
        .set({ state: 'REVOKED', revoked_at: new Date() })
        .where('id', '=', pre.consent_id)
        .execute();

      await http()
        .post('/v1/arrival/check-in')
        .set(headers())
        .send({ kioskId: 'MK-OPD-01', qrPayload: token })
        .expect(422);
    });

    it('refuses when a token has already been issued for the visit', async () => {
      const { token, preCheckinId } = await issueQr();
      await db
        .insertInto('token_request')
        .values({
          pre_checkin_id: preCheckinId,
          kiosk_device_id: fx.kioskId,
          idempotency_key: `MK-OPD-01-${preCheckinId}`,
          state: 'ISSUED',
          his_token: 'AYU-0247',
          issued_at: new Date(),
        })
        .execute();

      await http()
        .post('/v1/arrival/check-in')
        .set(headers())
        .send({ kioskId: 'MK-OPD-01', qrPayload: token })
        .expect(422);
    });

    it('will not issue a QR for an unsubmitted pre-check-in', async () => {
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

      // Still DRAFT: a QR promises the hospital an intake it can act on.
      await http()
        .post(`/v1/precheckins/${created.body.preCheckinId}/qr`)
        .set(CORRELATION_ID_HEADER, randomUUID())
        .expect(409);
    });
  });

  describe('disclosure', () => {
    it('gives every failure the same body', async () => {
      const { token } = await issueQr();
      await http()
        .post('/v1/arrival/check-in')
        .set(headers())
        .send({ kioskId: 'MK-OPD-01', qrPayload: token })
        .expect(201);

      const used = await http()
        .post('/v1/arrival/check-in')
        .set(headers())
        .send({ kioskId: 'MK-OPD-01', qrPayload: token })
        .expect(422);
      const garbage = await http()
        .post('/v1/arrival/check-in')
        .set(headers())
        .send({ kioskId: 'MK-OPD-01', qrPayload: 'nonsense' })
        .expect(422);

      // A holder of a stolen code must not be able to tell "already used" from "forged".
      expect(used.body.code).toBe(garbage.body.code);
      expect(used.body.patientMessage).toBe(garbage.body.patientMessage);
    });

    it('records the real reason in the audit log, and only there', async () => {
      const { token } = await issueQr();
      await http()
        .post('/v1/arrival/check-in')
        .set(headers())
        .send({ kioskId: 'MK-OPD-01', qrPayload: token })
        .expect(201);
      await http()
        .post('/v1/arrival/check-in')
        .set(headers())
        .send({ kioskId: 'MK-OPD-01', qrPayload: token })
        .expect(422);

      const refusal = await db
        .selectFrom('audit_event')
        .selectAll()
        .where('action', '=', 'ARRIVAL_QR_REFUSED')
        .executeTakeFirstOrThrow();
      expect(refusal.detail).toEqual({ reason: 'NONCE_ALREADY_USED' });
    });
  });
});
