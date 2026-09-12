import { sql, type Kysely } from 'kysely';
import type { Database } from '../src/db/database.types';
import { AuditRepository } from '../src/audit/audit.repository';
import { createTestDb, truncateAll } from './db-fixture';

const CORRELATION_ID = '7c2d1e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

describe('audit trail (integration)', () => {
  let db: Kysely<Database>;
  let repo: AuditRepository;

  beforeAll(async () => {
    db = await createTestDb();
    repo = new AuditRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  it('appends an event', async () => {
    await repo.append({
      actorId: 'kiosk:MK-OPD-01',
      actorRole: 'KIOSK',
      action: 'SESSION_STARTED',
      entityType: 'kiosk_session',
      entityId: 'abc',
      correlationId: CORRELATION_ID,
    });

    const rows = await db.selectFrom('audit_event').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('SESSION_STARTED');
  });

  it('redacts sensitive detail before it is stored', async () => {
    await repo.append({
      actorId: 'kiosk:MK-OPD-01',
      actorRole: 'KIOSK',
      action: 'OTP_VERIFIED',
      entityType: 'patient',
      correlationId: CORRELATION_ID,
      detail: { otp: '123456', mobile: '9876543210', name: 'Ravi Kumar', attempt: 1 },
    });

    const row = await db.selectFrom('audit_event').selectAll().executeTakeFirstOrThrow();
    const detail = row.detail as Record<string, unknown>;

    expect(detail['otp']).toBe('[REDACTED]');
    expect(detail['mobile']).toBe('******3210');
    expect(detail['name']).toBe('R*** K****');
    // Non-sensitive context survives, so the log is still useful.
    expect(detail['attempt']).toBe(1);
    expect(JSON.stringify(row)).not.toContain('123456');
    expect(JSON.stringify(row)).not.toContain('9876543210');
  });

  it('cannot be updated — the trail is append-only', async () => {
    await repo.append({
      actorId: 'staff:1',
      actorRole: 'DOCTOR',
      action: 'RECORD_VIEWED',
      entityType: 'encounter',
      correlationId: CORRELATION_ID,
    });

    // The rule makes this a silent no-op rather than an error, so verify by reading back:
    // a compromised service account must not be able to rewrite its own tracks.
    await sql`UPDATE audit_event SET action = 'TAMPERED'`.execute(db);

    const row = await db.selectFrom('audit_event').selectAll().executeTakeFirstOrThrow();
    expect(row.action).toBe('RECORD_VIEWED');
  });

  it('cannot be deleted', async () => {
    await repo.append({
      actorId: 'staff:1',
      actorRole: 'DOCTOR',
      action: 'RECORD_VIEWED',
      entityType: 'encounter',
      correlationId: CORRELATION_ID,
    });

    await sql`DELETE FROM audit_event`.execute(db);

    const rows = await db.selectFrom('audit_event').selectAll().execute();
    expect(rows).toHaveLength(1);
  });

  it('requires a reason for break-glass access', async () => {
    await expect(
      repo.append({
        actorId: 'staff:1',
        actorRole: 'DOCTOR',
        action: 'BREAK_GLASS_ACCESS',
        entityType: 'patient',
        correlationId: CORRELATION_ID,
      }),
    ).rejects.toThrow(/audit_break_glass_needs_reason/);
  });

  it('accepts break-glass access when a reason is given', async () => {
    await repo.append({
      actorId: 'staff:1',
      actorRole: 'DOCTOR',
      action: 'BREAK_GLASS_ACCESS',
      entityType: 'patient',
      correlationId: CORRELATION_ID,
      reason: 'Unconscious patient, treating physician needs history',
    });

    const row = await db.selectFrom('audit_event').selectAll().executeTakeFirstOrThrow();
    expect(row.reason).toContain('Unconscious patient');
  });
});
