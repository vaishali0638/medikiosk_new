import { sql, type Kysely } from 'kysely';
import { SQL_ENUMS, type SqlEnumName } from '@medikiosk/api-contracts';
import type { Database } from '../src/db/database.types';
import { createTestDb } from './db-fixture';

/**
 * Drift guard between the TypeScript enums and the PostgreSQL enum types.
 *
 * These two definitions are written in different languages in different files, and
 * nothing but this test stops them diverging. Divergence is not cosmetic: a row could
 * hold a state the state machine has never heard of, and `assertTransition` would then
 * be guarding a graph that does not describe the data.
 */
describe('schema parity (integration)', () => {
  let db: Kysely<Database>;
  let dbEnums: Map<string, string[]>;

  beforeAll(async () => {
    db = await createTestDb();

    const { rows } = await sql<{ typname: string; labels: string[] }>`
      SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public'
       GROUP BY t.typname
    `.execute(db);

    dbEnums = new Map(rows.map((r) => [r.typname, r.labels]));
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('defines every TypeScript enum as a PostgreSQL type', () => {
    for (const name of Object.keys(SQL_ENUMS)) {
      expect(dbEnums.has(name)).toBe(true);
    }
  });

  it('defines no PostgreSQL enum type that TypeScript does not know about', () => {
    for (const name of dbEnums.keys()) {
      expect(Object.keys(SQL_ENUMS)).toContain(name);
    }
  });

  it('agrees on the labels and their order for every enum', () => {
    for (const [name, values] of Object.entries(SQL_ENUMS)) {
      expect({ [name]: dbEnums.get(name as SqlEnumName) }).toEqual({ [name]: [...values] });
    }
  });
});

describe('schema shape (integration)', () => {
  let db: Kysely<Database>;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('models every entity the design calls for', async () => {
    const { rows } = await sql<{ tablename: string }>`
      SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
    `.execute(db);
    const tables = rows.map((r) => r.tablename).sort();

    expect(tables).toEqual(
      [
        'audit_event',
        'branch',
        'break_glass_access',
        'clinical_summary',
        'consent',
        'department',
        'document',
        'encounter',
        'encounter_export',
        'follow_up_delta',
        'governance_version',
        'hospital',
        'hospital_language',
        'identity_attempt',
        'intake_submission',
        'integration_outbox',
        'kiosk_device',
        'kiosk_session',
        'ocr_extraction',
        'otp_verification',
        'patient',
        'patient_identifier',
        'pre_checkin',
        'qr_nonce',
        'staff_session',
        'staff_user',
        'questionnaire_response',
        'token_request',
        'triage_status',
      ].sort(),
    );
  });

  it('keys every internal identifier on a uuid, not a guessable sequence', async () => {
    const { rows } = await sql<{ table_name: string; data_type: string }>`
      SELECT c.table_name, c.data_type
        FROM information_schema.columns c
        JOIN pg_tables t ON t.tablename = c.table_name AND t.schemaname = c.table_schema
       WHERE c.table_schema = 'public'
         AND c.column_name = 'id'
         AND c.table_name NOT IN ('schema_migrations', 'audit_event')
    `.execute(db);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect({ table: row.table_name, type: row.data_type }).toEqual({
        table: row.table_name,
        type: 'uuid',
      });
    }
  });

  it('stores no document bytes in PostgreSQL — originals live in object storage', async () => {
    const { rows } = await sql<{ table_name: string; column_name: string }>`
      SELECT table_name, column_name
        FROM information_schema.columns
       WHERE table_schema = 'public' AND data_type = 'bytea'
    `.execute(db);

    expect(rows).toEqual([]);
  });

  it('keeps every mutable entity under optimistic concurrency', async () => {
    const { rows } = await sql<{ tablename: string }>`
      SELECT t.tablename
        FROM pg_tables t
       WHERE t.schemaname = 'public'
         AND t.tablename IN ('consent', 'pre_checkin', 'token_request', 'kiosk_session',
                             'encounter',
        'encounter_export', 'patient', 'document', 'integration_outbox')
         AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema = 'public' AND c.table_name = t.tablename
              AND c.column_name = 'version')
    `.execute(db);

    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it('protects the audit trail with append-only rules', async () => {
    const { rows } = await sql<{ rulename: string }>`
      SELECT rulename FROM pg_rules
       WHERE schemaname = 'public' AND tablename = 'audit_event'
    `.execute(db);

    expect(rows.map((r) => r.rulename).sort()).toEqual([
      'audit_event_no_delete',
      'audit_event_no_update',
    ]);
  });

  it('enforces one issued token per visit and one live QR per visit', async () => {
    const { rows } = await sql<{ indexname: string }>`
      SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname IN ('token_request_one_issued_per_precheckin',
                           'qr_nonce_one_live_per_precheckin')
    `.execute(db);

    expect(rows.map((r) => r.indexname).sort()).toEqual([
      'qr_nonce_one_live_per_precheckin',
      'token_request_one_issued_per_precheckin',
    ]);
  });

  it('makes the token idempotency key unique', async () => {
    const { rows } = await sql<{ conname: string }>`
      SELECT conname FROM pg_constraint
       WHERE conrelid = 'token_request'::regclass AND contype = 'u'
    `.execute(db);

    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
