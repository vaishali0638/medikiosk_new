import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../src/db/database.types';
import { AuditRepository } from '../src/audit/audit.repository';
import { KioskSessionRepository } from '../src/kiosk/kiosk-session.repository';
import { InvalidStateTransitionError } from '../src/state-machines';
import { createTestDb, seedFixture, truncateAll, type Fixture } from './db-fixture';

const CORRELATION_ID = '9f8e7d6c-5b4a-4392-8180-7f6e5d4c3b2a';

describe('kiosk session (integration)', () => {
  let db: Kysely<Database>;
  let repo: KioskSessionRepository;
  let fx: Fixture;

  beforeAll(async () => {
    db = await createTestDb();
    repo = new KioskSessionRepository(db, new AuditRepository(db));
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAll(db);
    fx = await seedFixture(db);
  });

  const start = () => repo.start(fx.kioskId, fx.kioskCode, CORRELATION_ID);

  it('starts a session in CREATED with no patient attached', async () => {
    const session = await start();
    expect(session.state).toBe('CREATED');
    expect(session.patient_id).toBeNull();
    expect(session.ended_at).toBeNull();
    expect(session.wiped_at).toBeNull();
  });

  it('audits the session start', async () => {
    const session = await start();
    const events = await db
      .selectFrom('audit_event')
      .selectAll()
      .where('entity_id', '=', session.id)
      .execute();

    expect(events.map((e) => e.action)).toEqual(['SESSION_STARTED']);
    expect(events[0]?.actor_id).toBe(`kiosk:${fx.kioskCode}`);
  });

  it('gives each patient a distinct session', async () => {
    const first = await start();
    const second = await start();
    expect(first.id).not.toBe(second.id);
  });

  it('advances through the permitted states', async () => {
    const session = await start();
    const selected = await repo.transition(session.id, 'LANGUAGE_SELECTED', {
      language_tag: 'hi',
    });
    expect(selected.state).toBe('LANGUAGE_SELECTED');
    expect(selected.language_tag).toBe('hi');

    const pending = await repo.transition(session.id, 'CONSENT_PENDING');
    expect(pending.state).toBe('CONSENT_PENDING');
  });

  it('refuses to skip consent on the way to clinical intake', async () => {
    const session = await start();
    await repo.transition(session.id, 'LANGUAGE_SELECTED');
    await expect(repo.transition(session.id, 'INTAKE_IN_PROGRESS')).rejects.toThrow(
      InvalidStateTransitionError,
    );
  });

  it('wipes the session when the patient exits', async () => {
    const session = await start();
    await repo.transition(session.id, 'LANGUAGE_SELECTED', { language_tag: 'hi' });

    const ended = await repo.end(session.id, 'EXIT', fx.kioskCode, CORRELATION_ID);

    expect(ended.state).toBe('EXITED');
    expect(ended.ended_at).toBeInstanceOf(Date);
    expect(ended.wiped_at).toBeInstanceOf(Date);
  });

  it('leaves nothing on an ended session that links a kiosk to a patient', async () => {
    const session = await start();
    await repo.transition(session.id, 'LANGUAGE_SELECTED', { language_tag: 'hi' });
    await db
      .updateTable('kiosk_session')
      .set({ patient_id: fx.patientId, pre_checkin_id: fx.preCheckinId })
      .where('id', '=', session.id)
      .execute();

    const ended = await repo.end(session.id, 'EXIT', fx.kioskCode, CORRELATION_ID);

    expect(ended.patient_id).toBeNull();
    expect(ended.pre_checkin_id).toBeNull();
    expect(ended.language_tag).toBeNull();
  });

  it('records a timeout as EXPIRED, distinctly from a deliberate exit', async () => {
    const session = await start();
    const ended = await repo.end(session.id, 'TIMEOUT', fx.kioskCode, CORRELATION_ID);
    expect(ended.state).toBe('EXPIRED');
  });

  it('records an error termination and still wipes', async () => {
    const session = await start();
    const ended = await repo.end(session.id, 'ERROR', fx.kioskCode, CORRELATION_ID);
    expect(ended.state).toBe('EXITED');
    expect(ended.wiped_at).toBeInstanceOf(Date);
  });

  it('audits termination with the reason but no patient data', async () => {
    const session = await start();
    await repo.end(session.id, 'TIMEOUT', fx.kioskCode, CORRELATION_ID);

    const event = await db
      .selectFrom('audit_event')
      .selectAll()
      .where('entity_id', '=', session.id)
      .where('action', '=', 'SESSION_ENDED_TIMEOUT')
      .executeTakeFirstOrThrow();

    expect(event.detail).toEqual({ reason: 'TIMEOUT', previousState: 'CREATED' });
    expect(JSON.stringify(event)).not.toContain(fx.patientId);
  });

  it('is idempotent when a kiosk times out locally and then also reports an exit', async () => {
    const session = await start();
    const first = await repo.end(session.id, 'TIMEOUT', fx.kioskCode, CORRELATION_ID);
    const second = await repo.end(session.id, 'EXIT', fx.kioskCode, CORRELATION_ID);

    expect(second.id).toBe(first.id);
    expect(second.state).toBe('EXPIRED');
    expect(second.ended_at).toEqual(first.ended_at);
  });

  it('never revives an ended session through activity', async () => {
    const session = await start();
    await repo.end(session.id, 'EXIT', fx.kioskCode, CORRELATION_ID);
    expect(await repo.touch(session.id)).toBeUndefined();
  });

  it('refuses any further transition once ended', async () => {
    const session = await start();
    await repo.end(session.id, 'EXIT', fx.kioskCode, CORRELATION_ID);
    await expect(repo.transition(session.id, 'LANGUAGE_SELECTED')).rejects.toThrow(
      InvalidStateTransitionError,
    );
  });

  it('cannot be closed without a wipe, even bypassing the repository', async () => {
    const session = await start();
    // A client that failed to clear itself must not be able to record a clean close.
    await expect(
      db
        .updateTable('kiosk_session')
        .set({ state: 'EXITED', ended_at: new Date() })
        .where('id', '=', session.id)
        .execute(),
    ).rejects.toThrow(/kiosk_session_exit_is_wiped/);
  });

  it('expires sessions abandoned past the inactivity window', async () => {
    const stale = await start();
    const fresh = await start();
    await sql`UPDATE kiosk_session SET last_activity_at = now() - interval '10 minutes'
              WHERE id = ${stale.id}`.execute(db);

    // A kiosk that crashed or lost power never runs its own timer, so the server sweep
    // is what actually guarantees no session stays open holding a screen.
    expect(await repo.expireAbandoned(120)).toBe(1);

    expect((await repo.findById(stale.id))?.state).toBe('EXPIRED');
    // No wipe attestation, deliberately. The server is closing a row for a device it has
    // not heard from — the crashed kiosk this sweep exists for is exactly the one that
    // never wiped, and claiming otherwise recorded a fact nobody established.
    expect((await repo.findById(stale.id))?.wiped_at).toBeNull();
    expect((await repo.findById(fresh.id))?.state).toBe('CREATED');
  });

  it('resets the inactivity window on activity', async () => {
    const session = await start();
    await sql`UPDATE kiosk_session SET last_activity_at = now() - interval '10 minutes'
              WHERE id = ${session.id}`.execute(db);

    await repo.touch(session.id);
    expect(await repo.expireAbandoned(120)).toBe(0);
  });
});
