import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { Database } from '../src/db/database.types';
import { registerEnumArrayParsers } from '../src/db/db.provider';

export interface Fixture {
  readonly hospitalId: string;
  readonly branchId: string;
  readonly departmentId: string;
  readonly kioskId: string;
  readonly kioskCode: string;
  readonly patientId: string;
  readonly consentId: string;
  readonly preCheckinId: string;
}

/** Kysely owns the pool; `db.destroy()` closes it, so tests never end the pool directly. */
export async function createTestDb(): Promise<Kysely<Database>> {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] as string, max: 8 });
  // Same startup step the application performs, so tests exercise the real read path.
  await registerEnumArrayParsers(pool);
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

/** Empties every table between tests. TRUNCATE ... CASCADE also clears the audit table,
 *  which the append-only rules permit — they block UPDATE and DELETE, not TRUNCATE. */
export async function truncateAll(db: Kysely<Database>): Promise<void> {
  await sql`TRUNCATE TABLE
      audit_event, integration_outbox, triage_status, ocr_extraction, document,
      follow_up_delta, questionnaire_response, token_request, qr_nonce,
      kiosk_session, pre_checkin, encounter, consent, patient_identifier, patient,
      governance_version, kiosk_device, hospital_language, department, branch, hospital
    RESTART IDENTITY CASCADE`.execute(db);
}

/** One hospital, one department, one kiosk, one consented patient with a submitted
 *  pre-check-in — the minimum state from which arrival and token flows can be exercised. */
export async function seedFixture(db: Kysely<Database>): Promise<Fixture> {
  const hospital = await db
    .insertInto('hospital')
    .values({ code: 'HOSP-TEST', name: 'Test AYUSH Hospital' })
    .returningAll()
    .executeTakeFirstOrThrow();

  const branch = await db
    .insertInto('branch')
    .values({ hospital_id: hospital.id, code: 'MAIN', name: 'Main' })
    .returningAll()
    .executeTakeFirstOrThrow();

  const department = await db
    .insertInto('department')
    .values({
      branch_id: branch.id,
      code: 'AYU-OPD',
      name: 'Ayurveda OPD',
      ayush_system: 'AYURVEDA',
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const kiosk = await db
    .insertInto('kiosk_device')
    .values({ branch_id: branch.id, code: 'MK-OPD-01' })
    .returningAll()
    .executeTakeFirstOrThrow();

  const patient = await db
    .insertInto('patient')
    .values({
      hospital_id: hospital.id,
      full_name: 'Ravi Kumar',
      age_years: 58,
      sex: 'MALE',
      mobile: '9876543210',
      provisional: false,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const consent = await db
    .insertInto('consent')
    .values({
      patient_id: patient.id,
      hospital_id: hospital.id,
      purpose: 'OPD clinical intake and consultation',
      data_categories: ['demographics', 'clinical-history'],
      language_tag: 'hi',
      notice_version: 'v1.0',
      state: 'GRANTED',
      capture_method: 'MOBILE_PWA',
      valid_until: new Date(Date.now() + 86_400_000),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const now = Date.now();
  const preCheckin = await db
    .insertInto('pre_checkin')
    .values({
      patient_id: patient.id,
      consent_id: consent.id,
      hospital_id: hospital.id,
      branch_id: branch.id,
      department_id: department.id,
      visit_type: 'NEW_COMPLAINT',
      visit_window_start: new Date(now - 3_600_000),
      visit_window_end: new Date(now + 3_600_000),
      state: 'SUBMITTED',
      submitted_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return {
    hospitalId: hospital.id,
    branchId: branch.id,
    departmentId: department.id,
    kioskId: kiosk.id,
    kioskCode: kiosk.code,
    patientId: patient.id,
    consentId: consent.id,
    preCheckinId: preCheckin.id,
  };
}
