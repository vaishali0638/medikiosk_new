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
import { KioskSessionRepository } from '../src/kiosk/kiosk-session.repository';
import { createTestDb, seedFixture, truncateAll, type Fixture } from './db-fixture';

const OPS_KEY = process.env['OPS_API_KEY'] ?? 'integration-test-ops-key-0123456789';

describe('observability and operations (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let db: Kysely<Database>;
  let fx: Fixture;

  const http = () => request(app.getHttpServer());
  const base = (): Record<string, string> => ({ [CORRELATION_ID_HEADER]: randomUUID() });
  const ops = (): Record<string, string> => ({ ...base(), authorization: `Bearer ${OPS_KEY}` });
  const kiosk = (): Record<string, string> => ({
    ...base(),
    [KIOSK_DEVICE_HEADER]: 'MK-OPD-01',
  });

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
  });

  describe('metrics', () => {
    it('are not readable without an operations credential', async () => {
      // 401, not 400. This asserted 400 for a long time, which is simply the wrong word:
      // nothing about the request is malformed, the caller has not authenticated. It
      // mattered beyond pedantry because Prometheus scrapes /v1/metrics and a 4xx that is
      // not 401 — or worse the 500 an unconfigured key used to produce — reads as the API
      // being broken, which is a false outage alert from the one component whose job is to
      // notice real ones.
      await http().get('/v1/metrics').set(base()).expect(401);
      await http().get('/v1/ops/alerts').set(base()).expect(401);
    });

    it('refuse a wrong key exactly as they refuse a missing one', async () => {
      // Identical status and body, so a caller cannot learn from the response whether the
      // operations API is configured at all.
      const wrong = await http()
        .get('/v1/metrics')
        .set('Authorization', 'Bearer not-the-key-at-all-not-even-close')
        .expect(401);
      const absent = await http().get('/v1/metrics').expect(401);

      // Everything but the correlation id, which is per-request by design.
      const withoutCorrelation = (body: unknown): Record<string, unknown> => {
        const { correlationId, ...rest } = body as Record<string, unknown>;
        void correlationId;
        return rest;
      };
      expect(withoutCorrelation(wrong.body)).toEqual(withoutCorrelation(absent.body));
      expect(withoutCorrelation(wrong.body)).not.toHaveProperty('internalDetail');
    });

    it('render in Prometheus text format', async () => {
      const res = await http().get('/v1/metrics').set(ops()).expect(200);

      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.text).toContain('# HELP medikiosk_kiosk_total');
      expect(res.text).toContain('# TYPE medikiosk_kiosk_total gauge');
      expect(res.text).toMatch(/^medikiosk_kiosk_total \d+$/m);
    });

    it('count kiosks as online only while they are being seen', async () => {
      // Touching the config endpoint updates last_seen_at, which is how a kiosk is known
      // to be alive without a separate heartbeat.
      await http().get('/v1/kiosk/config').set(kiosk()).expect(200);
      let res = await http().get('/v1/metrics').set(ops()).expect(200);
      expect(res.text).toMatch(/^medikiosk_kiosk_online 1$/m);

      await db
        .updateTable('kiosk_device')
        .set({ last_seen_at: new Date(Date.now() - 60 * 60 * 1000) })
        .execute();

      res = await http().get('/v1/metrics').set(ops()).expect(200);
      expect(res.text).toMatch(/^medikiosk_kiosk_offline 1$/m);
      expect(res.text).toMatch(/^medikiosk_kiosk_online 0$/m);
    });

    it('contain no patient identifier, mobile number or clinical text', async () => {
      await db
        .insertInto('patient')
        .values({
          hospital_id: fx.hospitalId,
          full_name: 'Meena Rao',
          mobile: '9876500099',
          sex: 'FEMALE',
          age_years: 52,
          provisional: false,
        })
        .execute();
      await http().get('/v1/kiosk/config').set(kiosk()).expect(200);

      const res = await http().get('/v1/metrics').set(ops()).expect(200);

      // A metrics endpoint is scraped every fifteen seconds into a time-series database
      // that is not covered by the consent a patient gave. It may say how many, never who.
      expect(res.text).not.toContain('Meena');
      expect(res.text).not.toContain('9876500099');
      expect(res.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
      // Every line is a comment or a name-and-number.
      for (const line of res.text.trim().split('\n')) {
        expect(line).toMatch(/^(#|[a-z_]+(\{[^}]*\})? -?[\d.]+$)/);
      }
    });

    it('report a session that ended without a wipe attestation', async () => {
      // EXPIRED, not EXITED. A client that ends a session must attest to the wipe and
      // the constraint still enforces that; the server-side sweep cannot attest, and this
      // metric counts exactly those.
      const started = await http().post('/v1/kiosk/sessions').set(kiosk()).expect(201);
      await db
        .updateTable('kiosk_session')
        .set({ state: 'EXPIRED', ended_at: new Date(), wiped_at: null })
        .where('id', '=', started.body.sessionId)
        .execute();

      const res = await http().get('/v1/metrics').set(ops()).expect(200);
      // A privacy fault, not a performance one: a patient's data may still be on a device.
      expect(res.text).toMatch(/^medikiosk_sessions_ended_without_wipe 1$/m);
    });
  });

  describe('alerts', () => {
    it('fire for a kiosk nobody has seen', async () => {
      await db
        .updateTable('kiosk_device')
        .set({ last_seen_at: new Date(Date.now() - 60 * 60 * 1000) })
        .execute();

      const res = await http().get('/v1/ops/alerts').set(ops()).expect(200);
      const names = res.body.alerts.map((a: { name: string }) => a.name);
      expect(names).toContain('KioskOffline');
      expect(res.body.critical).toBeGreaterThan(0);
    });

    it('every firing alert names a runbook', async () => {
      await db
        .updateTable('kiosk_device')
        .set({ last_seen_at: new Date(Date.now() - 60 * 60 * 1000) })
        .execute();
      await db
        .insertInto('device_event')
        .values({
          kiosk_device_id: fx.kioskId,
          kind: 'PRINTER_FAULT',
          correlation_id: randomUUID(),
        })
        .execute();

      const res = await http().get('/v1/ops/alerts').set(ops()).expect(200);
      expect(res.body.alerts.length).toBeGreaterThan(1);

      // An alert with no instructions is a 2am page that begins with the recipient reading
      // source code. The runbook is a required field, so this cannot regress quietly.
      for (const alert of res.body.alerts) {
        expect(alert.runbook).toMatch(/^docs\/runbooks\//);
        expect(alert.summary.length).toBeGreaterThan(10);
      }
    });

    it('stay quiet when nothing is wrong', async () => {
      await http().get('/v1/kiosk/config').set(kiosk()).expect(200);
      const res = await http().get('/v1/ops/alerts').set(ops()).expect(200);

      // An alerting system people learn to ignore is worse than none, because it hides the
      // real one too.
      expect(res.body.firing).toBe(0);
    });

    it('fire on a burst of break-glass access', async () => {
      const staff = await db
        .insertInto('staff_user')
        .values({
          hospital_id: fx.hospitalId,
          subject: 'dr.busy',
          display_name: 'dr.busy',
          role: 'CLINICIAN',
          department_id: fx.departmentId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const encounter = await db
        .insertInto('encounter')
        .values({
          patient_id: fx.patientId,
          department_id: fx.departmentId,
          visit_type: 'NEW_COMPLAINT',
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      for (let i = 0; i < 5; i++) {
        await db
          .insertInto('break_glass_access')
          .values({
            staff_user_id: staff.id,
            encounter_id: encounter.id,
            reason: 'covering the evening clinic while the duty doctor is away',
            correlation_id: randomUUID(),
          })
          .execute();
      }

      const res = await http().get('/v1/ops/alerts').set(ops()).expect(200);
      expect(res.body.alerts.map((a: { name: string }) => a.name)).toContain(
        'UnusualAccessPattern',
      );
    });

    it('fire when a session ends with no wipe', async () => {
      const started = await http().post('/v1/kiosk/sessions').set(kiosk()).expect(201);
      await db
        .updateTable('kiosk_session')
        .set({ state: 'EXPIRED', ended_at: new Date(), wiped_at: null })
        .where('id', '=', started.body.sessionId)
        .execute();

      const res = await http().get('/v1/ops/alerts').set(ops()).expect(200);
      const alert = res.body.alerts.find(
        (a: { name: string }) => a.name === 'SessionEndedWithoutWipe',
      );
      expect(alert?.severity).toBe('CRITICAL');
    });
  });

  describe('the wipe attestation is not falsified', () => {
    it('still requires a client-ended session to attest', async () => {
      const started = await http().post('/v1/kiosk/sessions').set(kiosk()).expect(201);
      await expect(
        db
          .updateTable('kiosk_session')
          .set({ state: 'EXITED', ended_at: new Date(), wiped_at: null })
          .where('id', '=', started.body.sessionId)
          .execute(),
      ).rejects.toThrow();
    });

    it('does not claim a wipe for a session the server expired', async () => {
      const started = await http().post('/v1/kiosk/sessions').set(kiosk()).expect(201);
      await db
        .updateTable('kiosk_session')
        .set({ last_activity_at: new Date(Date.now() - 24 * 60 * 60 * 1000) })
        .where('id', '=', started.body.sessionId)
        .execute();

      const sessions = moduleRef.get(KioskSessionRepository);
      await sessions.expireAbandoned(300);

      const row = await db
        .selectFrom('kiosk_session')
        .selectAll()
        .where('id', '=', started.body.sessionId)
        .executeTakeFirstOrThrow();

      // The sweep exists for the kiosk that crashed or lost power — the one that never
      // wiped. Writing an attestation here recorded a fact nobody established, and hid
      // the sessions an operator most needs to see.
      expect(row.state).toBe('EXPIRED');
      expect(row.ended_at).not.toBeNull();
      expect(row.wiped_at).toBeNull();
    });
  });

  describe('device events', () => {
    const report = (body: Record<string, unknown>) =>
      http().post('/v1/kiosk/events').set(kiosk()).send(body);

    it('accepts a fault only from a provisioned kiosk', async () => {
      await report({ kind: 'PRINTER_FAULT' }).expect(201);
      await http()
        .post('/v1/kiosk/events')
        .set({ ...base(), [KIOSK_DEVICE_HEADER]: 'MK-FORGED' })
        .send({ kind: 'PRINTER_FAULT' })
        .expect(400);
    });

    it('refuses an unknown kind rather than storing free text', async () => {
      // A free-text kind becomes a dozen spellings of one fault and an alert rule that
      // matches none of them.
      await report({ kind: 'SOMETHING_ODD' }).expect(400);
    });

    it('redacts the detail it is given', async () => {
      await report({
        kind: 'APP_CRASH',
        detail: { exception: 'StateError', mobile: '9876500099', code: '123456' },
      }).expect(201);

      const row = await db.selectFrom('device_event').selectAll().executeTakeFirstOrThrow();
      const detail = JSON.stringify(row.detail);

      // A crash report is exactly the payload that arrives with a patient's details in a
      // local variable. The exception type survives; the rest does not.
      expect(detail).toContain('StateError');
      expect(detail).not.toContain('9876500099');
      expect(detail).not.toContain('123456');
    });

    it('keeps the device clock and the server clock apart', async () => {
      const happened = new Date(Date.now() - 30 * 60 * 1000);
      await report({ kind: 'NETWORK_RESTORED', occurredAt: happened.toISOString() }).expect(201);

      const row = await db.selectFrom('device_event').selectAll().executeTakeFirstOrThrow();
      // A kiosk that was offline reports late, and the gap is itself information.
      expect(new Date(row.occurred_at).getTime()).toBeCloseTo(happened.getTime(), -3);
      expect(new Date(row.reported_at).getTime()).toBeGreaterThan(happened.getTime());
    });

    it('surfaces recent faults to operations', async () => {
      await report({ kind: 'PRINTER_FAULT', detail: { status: 'PAPER_OUT' } }).expect(201);

      const res = await http().get('/v1/ops/device-events').set(ops()).expect(200);
      expect(res.body.events[0].kind).toBe('PRINTER_FAULT');
      expect(res.body.events[0].kioskCode).toBe('MK-OPD-01');
    });
  });
});
