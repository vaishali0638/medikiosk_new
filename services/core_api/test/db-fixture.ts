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
  const pool = new Pool({
    connectionString: process.env['DATABASE_URL'] as string,
    max: 8,
    // Without this, a suite that exhausts the pool waits for a connection forever and
    // reports it as a hang with no stack worth reading.
    connectionTimeoutMillis: 10_000,
  });
  // Same startup step the application performs, so tests exercise the real read path.
  await registerEnumArrayParsers(pool);
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

/** Empties every table between tests. TRUNCATE ... CASCADE also clears the audit table,
 *  which the append-only rules permit — they block UPDATE and DELETE, not TRUNCATE. */
export async function truncateAll(db: Kysely<Database>): Promise<void> {
  try {
    await db.transaction().execute(async (trx) => {
      // A TRUNCATE needs ACCESS EXCLUSIVE on every table listed, and Postgres will wait
      // for it indefinitely by default. That default turned one stray uncommitted write
      // into a ten-minute silent hang in a random suite, which cost far more to diagnose
      // than the failure it was hiding. Ten seconds is longer than any legitimate holder
      // of these locks between tests, so anything that trips this is a real defect and
      // should say so immediately.
      await sql`SET LOCAL lock_timeout = '10s'`.execute(trx);
      await sql`TRUNCATE TABLE
          audit_event, integration_outbox, triage_status, ocr_extraction, document,
          follow_up_delta, questionnaire_response, token_request, qr_nonce,
          kiosk_session, pre_checkin, encounter, consent, patient_identifier, patient,
          governance_transition, governance_version, device_event, kiosk_device,
          hospital_language, department, branch, hospital,
          staff_session, staff_user, break_glass_access, encounter_export,
          legal_hold, retention_policy,
          -- Rate-limit windows are state too. Without this, a suite that signs in as the
          -- same subject in a dozen tests exhausts the bucket partway through and the rest
          -- fail with 429 — which is the limiter working, on the wrong thing.
          rate_limit_bucket
        RESTART IDENTITY CASCADE`.execute(trx);
    });
  } catch (error) {
    if (!isLockTimeout(error)) throw error;
    throw new Error(`truncateAll could not lock the schema.\n${await describeBlockers(db)}`);
  }
}

/** Postgres raises `lock_not_available` when `lock_timeout` elapses. */
function isLockTimeout(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === '55P03'
  );
}

/**
 * Names whoever is holding the locks, so the next person sees the cause rather than
 * repeating the investigation. Best-effort: if this query itself fails, the lock timeout
 * is still reported.
 */
async function describeBlockers(db: Kysely<Database>): Promise<string> {
  try {
    const { rows } = await sql<{
      pid: number;
      state: string | null;
      wait_event_type: string | null;
      seconds: number | null;
      query: string | null;
    }>`SELECT pid, state, wait_event_type,
              round(extract(epoch FROM (now() - state_change)))::int AS seconds,
              left(query, 200) AS query
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
        ORDER BY state_change`.execute(db);

    if (rows.length === 0)
      return 'No other sessions are connected — suspect a lock this pool holds itself.';
    return rows
      .map(
        (r) =>
          `  pid ${r.pid} ${r.state ?? 'unknown'} for ${r.seconds ?? '?'}s [${r.wait_event_type ?? 'running'}]: ${r.query ?? ''}`,
      )
      .join('\n');
  } catch {
    return '(could not read pg_stat_activity)';
  }
}

/**
 * Publishes a consent notice for one language.
 *
 * A hospital with reviewed language labels but no published notice offers a patient
 * nothing they can lawfully agree to, so most fixtures need at least one.
 */
export async function publishConsentNotice(
  db: Kysely<Database>,
  hospitalId: string,
  language: string,
  version = 'v1.0',
): Promise<void> {
  await db
    .insertInto('governance_version')
    .values({
      hospital_id: hospitalId,
      content_kind: 'CONSENT_NOTICE',
      content_key: `consent-notice/${language}`,
      semver: '1.0.0',
      state: 'PUBLISHED',
      published_by_user_id: 'SEED',
      published_at: new Date(),
      payload: JSON.stringify({
        version,
        title: language === 'hi' ? 'गोपनीयता और सहमति' : 'Privacy and consent',
        collectedItems: ['Basic patient details', 'Health information'],
        purpose: 'OPD clinical intake and consultation at this hospital',
        dataCategories: ['demographics', 'clinical-history'],
        fullText: 'Full notice text for tests.',
        audioAvailable: false,
      }),
      author_actor_id: 'TEST',
      approvals: JSON.stringify([{ by: 'Dr Test', role: 'CLINICAL_REVIEWER' }]),
      effective_from: new Date(),
    })
    .execute();
}

/** One hospital, one department, one kiosk, one consented patient with a submitted
 *  pre-check-in — the minimum state from which arrival and token flows can be exercised.
 *  English is configured and has a published notice, so the hospital is usable as seeded. */
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

  await db
    .insertInto('hospital_language')
    .values({
      hospital_id: hospital.id,
      language_tag: 'en',
      label: 'English',
      clinically_reviewed: true,
      audio_available: false,
    })
    .execute();

  await publishConsentNotice(db, hospital.id, 'en');

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
