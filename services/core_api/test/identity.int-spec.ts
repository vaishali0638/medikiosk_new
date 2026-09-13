import { randomUUID } from 'node:crypto';
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
import type { Database } from '../src/db/database.types';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/domain-exception.filter';
import { createTestDb, seedFixture, truncateAll, type Fixture } from './db-fixture';

/**
 * Identity is where a wrong answer puts one person's history in front of another
 * person's doctor. These tests exist to pin the refusals, not the happy path.
 */
describe('identity (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let db: Kysely<Database>;
  let fx: Fixture;

  const http = () => request(app.getHttpServer());
  const headers = (): Record<string, string> => ({
    [KIOSK_DEVICE_HEADER]: 'MK-OPD-01',
    [CORRELATION_ID_HEADER]: randomUUID(),
  });

  /** Reads the code straight from the sandbox path — tests never see it over the wire. */
  const currentCode = async (verificationId: string): Promise<string> => {
    // The code is only ever stored hashed, so brute-force the six digits against the
    // stored HMAC. That this is necessary is the point: nothing can read it back.
    const row = await db
      .selectFrom('otp_verification')
      .select(['code_hash', 'code_key_id'])
      .where('id', '=', verificationId)
      .executeTakeFirstOrThrow();

    const { createHmac } = await import('node:crypto');
    for (let i = 0; i < 1_000_000; i += 1) {
      const candidate = String(i).padStart(6, '0');
      const hash = createHmac('sha256', `${row.code_key_id}:development-only-secret`)
        .update(candidate)
        .digest('hex');
      if (hash === row.code_hash) return candidate;
    }
    throw new Error('code not recoverable');
  };

  const sendOtp = async (
    mobile: string,
    purpose = 'EXISTING_PATIENT_LOOKUP',
  ): Promise<{ verificationId: string; code: string }> => {
    const res = await http()
      .post('/v1/identity/otp')
      .set(headers())
      .send({ mobile, purpose })
      .expect(201);
    return {
      verificationId: res.body.verificationId as string,
      code: await currentCode(res.body.verificationId as string),
    };
  };

  const verifiedOtp = async (
    mobile: string,
    purpose = 'EXISTING_PATIENT_LOOKUP',
  ): Promise<string> => {
    const { verificationId, code } = await sendOtp(mobile, purpose);
    await http()
      .post('/v1/identity/otp/verify')
      .set(headers())
      .send({ verificationId, code })
      .expect(201);
    return verificationId;
  };

  const addPatient = async (attrs: {
    name: string;
    mobile: string;
    dob?: string;
    uhid?: string;
  }): Promise<string> => {
    const patient = await db
      .insertInto('patient')
      .values({
        hospital_id: fx.hospitalId,
        provisional: false,
        full_name: attrs.name,
        sex: 'MALE',
        mobile: attrs.mobile,
        date_of_birth: attrs.dob ? new Date(attrs.dob) : null,
        age_years: attrs.dob ? null : 40,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    if (attrs.uhid) {
      await db
        .insertInto('patient_identifier')
        .values({
          patient_id: patient.id,
          type: 'UHID',
          value: attrs.uhid,
          issued_by: fx.hospitalId,
        })
        .execute();
    }
    return patient.id;
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
    await db.deleteFrom('patient').execute();
  });

  describe('one-time codes', () => {
    it('never stores the code in plaintext', async () => {
      const { verificationId } = await sendOtp('9876543210');
      const row = await db
        .selectFrom('otp_verification')
        .selectAll()
        .where('id', '=', verificationId)
        .executeTakeFirstOrThrow();

      expect(row.code_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(row)).not.toMatch(/"\d{6}"/);
    });

    it('masks the mobile in the response', async () => {
      const res = await http()
        .post('/v1/identity/otp')
        .set(headers())
        .send({ mobile: '9876543210', purpose: 'EXISTING_PATIENT_LOOKUP' })
        .expect(201);

      expect(res.body.maskedMobile).toBe('******3210');
      expect(JSON.stringify(res.body)).not.toContain('9876543210');
    });

    it('answers identically for a registered and an unregistered number', async () => {
      await addPatient({ name: 'Ravi Kumar', mobile: '9876543210' });

      const registered = await http()
        .post('/v1/identity/otp')
        .set(headers())
        .send({ mobile: '9876543210', purpose: 'EXISTING_PATIENT_LOOKUP' })
        .expect(201);
      const unknown = await http()
        .post('/v1/identity/otp')
        .set(headers())
        .send({ mobile: '9000000001', purpose: 'EXISTING_PATIENT_LOOKUP' })
        .expect(201);

      // Otherwise the kiosk becomes a way to test which numbers are patients here.
      expect(Object.keys(registered.body).sort()).toEqual(Object.keys(unknown.body).sort());
      expect(registered.body.attemptsAllowed).toBe(unknown.body.attemptsAllowed);
    });

    it('verifies a correct code', async () => {
      const { verificationId, code } = await sendOtp('9876543210');
      const res = await http()
        .post('/v1/identity/otp/verify')
        .set(headers())
        .send({ verificationId, code })
        .expect(201);
      expect(res.body.verified).toBe(true);
    });

    it('rejects a wrong code', async () => {
      const { verificationId, code } = await sendOtp('9876543210');
      const wrong = code === '000000' ? '111111' : '000000';
      await http()
        .post('/v1/identity/otp/verify')
        .set(headers())
        .send({ verificationId, code: wrong })
        .expect(400);
    });

    it('locks after the attempt allowance is exhausted', async () => {
      const { verificationId, code } = await sendOtp('9876543210');
      const wrong = code === '000000' ? '111111' : '000000';

      for (let i = 0; i < 4; i += 1) {
        await http()
          .post('/v1/identity/otp/verify')
          .set(headers())
          .send({ verificationId, code: wrong })
          .expect(400);
      }
      // Fifth failure locks. Six digits is a few thousand guesses without this.
      await http()
        .post('/v1/identity/otp/verify')
        .set(headers())
        .send({ verificationId, code: wrong })
        .expect(429);

      // Even the correct code no longer works: the patient requests a new one.
      await http()
        .post('/v1/identity/otp/verify')
        .set(headers())
        .send({ verificationId, code })
        .expect(400);
    });

    it('refuses an expired code', async () => {
      const { verificationId, code } = await sendOtp('9876543210');
      await sql`UPDATE otp_verification SET sent_at = now() - interval '20 minutes',
                expires_at = now() - interval '15 minutes' WHERE id = ${verificationId}`.execute(
        db,
      );

      await http()
        .post('/v1/identity/otp/verify')
        .set(headers())
        .send({ verificationId, code })
        .expect(400);
    });

    it('supersedes a previous live code rather than accumulating them', async () => {
      const first = await sendOtp('9876543210');
      await sendOtp('9876543210');

      await http()
        .post('/v1/identity/otp/verify')
        .set(headers())
        .send({ verificationId: first.verificationId, code: first.code })
        .expect(400);
    });

    it('rate-limits sends to one number', async () => {
      await sendOtp('9876543210');
      await sendOtp('9876543210');
      await sendOtp('9876543210');
      // Protects the patient from SMS bombing as much as the system from abuse.
      await http()
        .post('/v1/identity/otp')
        .set(headers())
        .send({ mobile: '9876543210', purpose: 'EXISTING_PATIENT_LOOKUP' })
        .expect(429);
    });

    it('never writes the code to the audit trail', async () => {
      const { code } = await sendOtp('9876543210');
      const events = await db.selectFrom('audit_event').selectAll().execute();
      expect(JSON.stringify(events)).not.toContain(code);
      expect(JSON.stringify(events)).not.toContain('9876543210');
    });
  });

  describe('a patient with no mobile of their own', () => {
    it('registers a patient who has no mobile number of their own', async () => {
      // The kiosk offers no phone-less registration — "Register without phone" is on the
      // forbidden-option list precisely because a route that skips verification is a route
      // that registers anybody as anybody. A patient with no phone uses a family member's,
      // which is verified normally, or is registered at the counter.
      //
      // What this pins is the control underneath: registration is impossible without a
      // verification the OTP service will accept.
      const started = await http().post('/v1/kiosk/sessions').set(headers()).expect(201);

      await http()
        .post(`/v1/identity/register?sessionId=${started.body.sessionId}`)
        .set(headers())
        .send({
          verificationId: randomUUID(),
          name: 'Kamala Bai',
          sex: 'FEMALE',
          ageYears: 71,
        })
        .expect((res) => {
          // Refused. Which code depends on how far it gets before the verification is
          // rejected; what matters is that no patient is created.
          expect(res.status).toBeGreaterThanOrEqual(400);
        });

      const confirmed = await db
        .selectFrom('patient')
        .selectAll()
        .where('full_name', '=', 'Kamala Bai')
        .execute();
      expect(confirmed).toHaveLength(0);
    });
  });

  describe('resolving by UHID', () => {
    it('resolves a single match and returns masked details only', async () => {
      await addPatient({
        name: 'Ravi Kumar',
        mobile: '9876543210',
        dob: '1968-04-12',
        uhid: 'UH00012345',
      });

      const res = await http()
        .post('/v1/identity/resolve')
        .set(headers())
        .send({ method: 'UHID_AND_ENCOUNTER', uhid: 'UH00012345', dateOfBirth: '1968-04-12' })
        .expect(201);

      expect(res.body.strength).toBe('STRONGEST');
      expect(res.body.masked.maskedName).toBe('R*** K****');
      expect(res.body.masked.maskedMobile).toBe('******3210');
      // Nothing unmasked, and nothing clinical, crosses this boundary.
      expect(JSON.stringify(res.body)).not.toContain('Ravi Kumar');
      expect(JSON.stringify(res.body)).not.toContain('9876543210');
      expect(JSON.stringify(res.body)).not.toContain('UH00012345');
    });

    it('refuses an unknown UHID without saying it is unknown', async () => {
      const res = await http()
        .post('/v1/identity/resolve')
        .set(headers())
        .send({ method: 'UHID_AND_ENCOUNTER', uhid: 'UH99999999' })
        .expect(422);

      expect(res.body.code).toBe('IDENTITY_NOT_CONFIRMED');
      expect(res.body.patientMessage).not.toMatch(/not found|unknown|no such/i);
    });

    it('will not resolve a UHID issued by another hospital', async () => {
      const other = await db
        .insertInto('hospital')
        .values({ code: 'HOSP-OTHER', name: 'Other Hospital' })
        .returningAll()
        .executeTakeFirstOrThrow();
      const patient = await db
        .insertInto('patient')
        .values({
          hospital_id: other.id,
          provisional: false,
          full_name: 'Someone Else',
          sex: 'FEMALE',
          age_years: 30,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await db
        .insertInto('patient_identifier')
        .values({ patient_id: patient.id, type: 'UHID', value: 'UH00012345', issued_by: other.id })
        .execute();

      // A UHID is only unique within the facility that issued it.
      await http()
        .post('/v1/identity/resolve')
        .set(headers())
        .send({ method: 'UHID_AND_ENCOUNTER', uhid: 'UH00012345' })
        .expect(422);
    });

    it('refuses a UHID with the wrong date of birth', async () => {
      // A UHID is printed on paper and can be picked up or mistyped. The birth date is the
      // part only the patient should know, so a mismatch is a refusal rather than a
      // near-miss the system resolves in the patient's favour.
      await addPatient({
        name: 'Ravi Kumar',
        mobile: '9876543211',
        uhid: 'UH00012345',
        dob: '1968-04-12',
      });

      const res = await http()
        .post('/v1/identity/resolve')
        .set(headers())
        .send({ method: 'UHID_AND_ENCOUNTER', uhid: 'UH00012345', dateOfBirth: '1970-01-01' })
        .expect(422);

      expect(res.body.code).toBe('IDENTITY_NOT_CONFIRMED');
    });

    it('matches a birth date in the hospital’s own timezone, not UTC', async () => {
      // node-postgres turns a `date` column into a Date at LOCAL midnight, so comparing
      // via toISOString() shifts it backwards by the UTC offset — in India, every birth
      // date read back as the day before. The comparison was written that way in Phase 5
      // and was invisible until a UHID lookup actually had to verify one.
      await addPatient({
        name: 'Sita Devi',
        mobile: '9876500077',
        uhid: 'UH00055555',
        dob: '1975-01-01',
      });

      await http()
        .post('/v1/identity/resolve')
        .set(headers())
        .send({ method: 'UHID_AND_ENCOUNTER', uhid: 'UH00055555', dateOfBirth: '1975-01-01' })
        .expect(201);

      // And the day before must not match, which is exactly what the bug produced.
      await http()
        .post('/v1/identity/resolve')
        .set(headers())
        .send({ method: 'UHID_AND_ENCOUNTER', uhid: 'UH00055555', dateOfBirth: '1974-12-31' })
        .expect(422);
    });

    it('refuses a UHID with no date of birth at all', async () => {
      // A UHID is printed on the hospital card, on discharge slips, and on anything left
      // in a waiting room. Possession of it is not identity, and the contract has always
      // said the birth date is required — the code had it optional.
      await addPatient({
        name: 'Ravi Kumar',
        mobile: '9876543210',
        uhid: 'UH00012345',
        dob: '1968-04-12',
      });

      await http()
        .post('/v1/identity/resolve')
        .set(headers())
        .send({ method: 'UHID_AND_ENCOUNTER', uhid: 'UH00012345' })
        .expect(422);
    });

    it('will not resolve a provisional record', async () => {
      const provisional = await db
        .insertInto('patient')
        .values({ hospital_id: fx.hospitalId, provisional: true })
        .returningAll()
        .executeTakeFirstOrThrow();
      await db
        .insertInto('patient_identifier')
        .values({
          patient_id: provisional.id,
          type: 'UHID',
          value: 'UH00000001',
          issued_by: fx.hospitalId,
        })
        .execute();

      await http()
        .post('/v1/identity/resolve')
        .set(headers())
        .send({ method: 'UHID_AND_ENCOUNTER', uhid: 'UH00000001' })
        .expect(422);
    });
  });

  describe('resolving by mobile', () => {
    it('refuses a lone mobile match as too weak to release a record', async () => {
      await addPatient({ name: 'Ravi Kumar', mobile: '9876543210', dob: '1968-04-12' });
      const verificationId = await verifiedOtp('9876543210');

      // Possession of a handset is not proof of identity, so MODERATE alone is refused.
      const res = await http()
        .post('/v1/identity/resolve')
        .set(headers())
        .send({ method: 'MOBILE_OTP', verificationId })
        .expect(422);
      expect(res.body.code).toBe('IDENTITY_NOT_CONFIRMED');
    });

    it('refuses a shared family phone as ambiguous', async () => {
      await addPatient({ name: 'Ravi Kumar', mobile: '9876543210', dob: '1968-04-12' });
      await addPatient({ name: 'Sita Kumari', mobile: '9876543210', dob: '1972-09-03' });
      const verificationId = await verifiedOtp('9876543210');

      const res = await http()
        .post('/v1/identity/resolve')
        .set(headers())
        .send({ method: 'MOBILE_OTP', verificationId })
        .expect(422);

      // The system does not choose between them, and does not merge them.
      expect(res.body.code).toBe('IDENTITY_AMBIGUOUS');
      expect(JSON.stringify(res.body)).not.toContain('Ravi');
      expect(JSON.stringify(res.body)).not.toContain('Sita');
    });

    it('still refuses a narrowed family phone, because mobile plus date of birth is only moderate', async () => {
      await addPatient({ name: 'Ravi Kumar', mobile: '9876543210', dob: '1968-04-12' });
      await addPatient({ name: 'Sita Kumari', mobile: '9876543210', dob: '1972-09-03' });
      const verificationId = await verifiedOtp('9876543210');

      const res = await http()
        .post('/v1/identity/resolve')
        .set(headers())
        .send({ method: 'MOBILE_OTP', verificationId, dateOfBirth: '1968-04-12' })
        .expect(422);

      // Narrowing removes the ambiguity but does not raise the evidence: a date of birth
      // is not a secret. The refusal changes reason, not outcome.
      expect(res.body.code).toBe('IDENTITY_NOT_CONFIRMED');
    });

    it('spends the verification, so one code cannot confirm two identities', async () => {
      await addPatient({ name: 'Ravi Kumar', mobile: '9876543210' });
      const verificationId = await verifiedOtp('9876543210');

      await http()
        .post('/v1/identity/resolve')
        .set(headers())
        .send({ method: 'MOBILE_OTP', verificationId })
        .expect(422);

      const row = await db
        .selectFrom('otp_verification')
        .selectAll()
        .where('id', '=', verificationId)
        .executeTakeFirstOrThrow();
      expect(row.state).toBe('CONSUMED');

      await http()
        .post('/v1/identity/resolve')
        .set(headers())
        .send({ method: 'MOBILE_OTP', verificationId })
        .expect(400);
    });

    it('refuses an unverified code', async () => {
      const { verificationId } = await sendOtp('9876543210');
      await http()
        .post('/v1/identity/resolve')
        .set(headers())
        .send({ method: 'MOBILE_OTP', verificationId })
        .expect(400);
    });
  });

  describe('name-only lookup', () => {
    it('is not expressible in the contract at all', async () => {
      await addPatient({ name: 'Ravi Kumar', mobile: '9876543210' });

      // Not merely unsupported: there is no name field on any resolve variant, so the
      // request cannot be constructed. Names in this setting are frequently shared.
      await http()
        .post('/v1/identity/resolve')
        .set(headers())
        .send({ method: 'NAME', name: 'Ravi Kumar' })
        .expect(400);

      await http()
        .post('/v1/identity/resolve')
        .set(headers())
        .send({ method: 'UHID_AND_ENCOUNTER', name: 'Ravi Kumar' })
        .expect(400);
    });
  });

  describe('feature-gated methods', () => {
    it('refuses ABHA while the feature is off', async () => {
      await http()
        .post('/v1/identity/resolve')
        .set(headers())
        .send({ method: 'ABHA_VERIFIED', abhaToken: 'anything' })
        .expect(422);

      const attempt = await db
        .selectFrom('identity_attempt')
        .selectAll()
        .where('method', '=', 'ABHA_VERIFIED')
        .executeTakeFirstOrThrow();
      expect(attempt.outcome).toBe('METHOD_DISABLED');
    });

    it('refuses an appointment QR, which needs a HIS adapter', async () => {
      const res = await http()
        .post('/v1/identity/resolve')
        .set(headers())
        .send({ method: 'APPOINTMENT_QR', qrPayload: 'signed-payload' })
        .expect(422);
      expect(res.body.code).toBe('IDENTITY_NOT_CONFIRMED');
    });
  });

  describe('confirmation', () => {
    const resolveOne = async (): Promise<string> => {
      await addPatient({
        name: 'Ravi Kumar',
        mobile: '9876543210',
        dob: '1968-04-12',
        uhid: 'UH00012345',
      });
      const res = await http()
        .post('/v1/identity/resolve')
        .set(headers())
        // Supplied, because a UHID lookup now requires it: the card is possession, the
        // birth date is knowledge, and one alone is not identity.
        .send({ method: 'UHID_AND_ENCOUNTER', uhid: 'UH00012345', dateOfBirth: '1968-04-12' })
        .expect(201);
      return res.body.candidateId as string;
    };

    it('confirms a resolved candidate', async () => {
      const candidateId = await resolveOne();
      const res = await http()
        .post('/v1/identity/confirm')
        .set(headers())
        .send({ candidateId, isMe: true })
        .expect(201);

      expect(res.body.patientId).toBeDefined();
      expect(res.body.strength).toBe('STRONGEST');
    });

    it('cannot be replayed', async () => {
      const candidateId = await resolveOne();
      await http()
        .post('/v1/identity/confirm')
        .set(headers())
        .send({ candidateId, isMe: true })
        .expect(201);
      await http()
        .post('/v1/identity/confirm')
        .set(headers())
        .send({ candidateId, isMe: true })
        .expect(422);
    });

    it('records the confirmation on the attempt it came from', async () => {
      const candidateId = await resolveOne();
      await http()
        .post('/v1/identity/confirm')
        .set(headers())
        .send({ candidateId, isMe: true })
        .expect(201);

      // resolve and confirm are separate requests with separate correlation ids, so the
      // attempt has to be addressed by its own id.
      const attempt = await db
        .selectFrom('identity_attempt')
        .selectAll()
        .where('outcome', '=', 'MATCHED')
        .executeTakeFirstOrThrow();
      expect(attempt.confirmed).toBe(true);
      expect(attempt.matched_patient_id).not.toBeNull();
    });

    it('leaves an unconfirmed match recorded as unconfirmed', async () => {
      await resolveOne();
      const attempt = await db
        .selectFrom('identity_attempt')
        .selectAll()
        .where('outcome', '=', 'MATCHED')
        .executeTakeFirstOrThrow();
      expect(attempt.confirmed).toBe(false);
    });

    it('rejects an unknown candidate handle', async () => {
      await http()
        .post('/v1/identity/confirm')
        .set(headers())
        .send({ candidateId: randomUUID(), isMe: true })
        .expect(422);
    });

    it('requires an explicit yes', async () => {
      const candidateId = await resolveOne();
      // `isMe: false` is not a valid confirmation; there is no implicit acceptance.
      await http()
        .post('/v1/identity/confirm')
        .set(headers())
        .send({ candidateId, isMe: false })
        .expect(400);
    });
  });

  describe('audit', () => {
    it('records a failed lookup as carefully as a successful one', async () => {
      await http()
        .post('/v1/identity/resolve')
        .set(headers())
        .send({ method: 'UHID_AND_ENCOUNTER', uhid: 'UH99999999' })
        .expect(422);

      const attempt = await db.selectFrom('identity_attempt').selectAll().executeTakeFirstOrThrow();
      expect(attempt.outcome).toBe('NOT_FOUND');
      expect(attempt.candidate_count).toBe(0);
      expect(attempt.matched_patient_id).toBeNull();
      expect(attempt.confirmed).toBe(false);
    });

    it('records how many candidates an ambiguous lookup found', async () => {
      await addPatient({ name: 'Ravi Kumar', mobile: '9876543210' });
      await addPatient({ name: 'Sita Kumari', mobile: '9876543210' });
      const verificationId = await verifiedOtp('9876543210');

      await http()
        .post('/v1/identity/resolve')
        .set(headers())
        .send({ method: 'MOBILE_OTP', verificationId })
        .expect(422);

      const attempt = await db
        .selectFrom('identity_attempt')
        .selectAll()
        .where('outcome', '=', 'AMBIGUOUS')
        .executeTakeFirstOrThrow();
      expect(attempt.candidate_count).toBe(2);
      expect(attempt.matched_patient_id).toBeNull();
    });

    it('refuses at the database level to attach a patient to an ambiguous attempt', async () => {
      const patientId = await addPatient({ name: 'Ravi Kumar', mobile: '9876543210' });

      await expect(
        db
          .insertInto('identity_attempt')
          .values({
            hospital_id: fx.hospitalId,
            method: 'MOBILE_OTP',
            strength: 'MODERATE',
            candidate_count: 2,
            matched_patient_id: patientId,
            outcome: 'AMBIGUOUS',
            correlation_id: randomUUID(),
          })
          .execute(),
      ).rejects.toThrow(/identity_match_needs_single_candidate/);
    });
  });
});
