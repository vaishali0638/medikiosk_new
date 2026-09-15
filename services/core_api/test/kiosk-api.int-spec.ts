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
import {
  createTestDb,
  publishConsentNotice,
  seedFixture,
  truncateAll,
  type Fixture,
} from './db-fixture';

describe('kiosk API (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let db: Kysely<Database>;
  let fx: Fixture;

  const correlationId = randomUUID();
  const http = () => request(app.getHttpServer());
  const headers = (device = 'MK-OPD-01'): Record<string, string> => ({
    [KIOSK_DEVICE_HEADER]: device,
    [CORRELATION_ID_HEADER]: correlationId,
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
    // The fixture seeds English with a published notice. Add Hindi (reviewed, notice
    // published) and Tamil (configured but unreviewed) so both gates are exercised.
    await db
      .insertInto('hospital_language')
      .values([
        {
          hospital_id: fx.hospitalId,
          language_tag: 'hi',
          label: 'हिन्दी',
          clinically_reviewed: true,
          audio_available: true,
        },
        {
          hospital_id: fx.hospitalId,
          language_tag: 'ta',
          label: 'தமிழ்',
          clinically_reviewed: false,
          audio_available: false,
        },
      ])
      .execute();
    await publishConsentNotice(db, fx.hospitalId, 'hi');
  });

  describe('device identification', () => {
    it('rejects a request with no device header', async () => {
      const res = await http()
        .get('/v1/kiosk/config')
        .set(CORRELATION_ID_HEADER, correlationId)
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('rejects an unknown device', async () => {
      await http().get('/v1/kiosk/config').set(headers('MK-NOT-REAL')).expect(400);
    });

    it('rejects a disabled device the same way as an unknown one, so codes cannot be probed', async () => {
      await db
        .updateTable('kiosk_device')
        .set({ enabled: false })
        .where('code', '=', 'MK-OPD-01')
        .execute();

      const disabled = await http().get('/v1/kiosk/config').set(headers()).expect(400);
      const unknown = await http().get('/v1/kiosk/config').set(headers('MK-NOT-REAL')).expect(400);

      expect(disabled.body.code).toBe(unknown.body.code);
      expect(disabled.body.patientMessage).toBe(unknown.body.patientMessage);
    });

    it('never leaks internal detail to the client', async () => {
      const res = await http().get('/v1/kiosk/config').set(headers('MK-NOT-REAL')).expect(400);
      expect(Object.keys(res.body).sort()).toEqual(['code', 'correlationId', 'patientMessage']);
      expect(JSON.stringify(res.body)).not.toContain('MK-NOT-REAL');
    });
  });

  describe('GET /v1/kiosk/config', () => {
    it('returns the hospital, branch and kiosk identity', async () => {
      const res = await http().get('/v1/kiosk/config').set(headers()).expect(200);
      expect(res.body.hospitalId).toBe('HOSP-TEST');
      expect(res.body.kioskId).toBe('MK-OPD-01');
    });

    it('offers only clinically reviewed languages', async () => {
      const res = await http().get('/v1/kiosk/config').set(headers()).expect(200);
      const tags = res.body.languages.map((l: { tag: string }) => l.tag).sort();
      // Tamil is configured but unreviewed, so it must not be offered.
      expect(tags).toEqual(['en', 'hi']);
    });

    it('labels a language with its endonym, not whatever the hospital typed', async () => {
      // An administrator configuring a hospital will sooner or later type the Latin name
      // into this field. A patient who reads only Odia cannot find "Odia" in a list
      // written in an alphabet they do not read, so what a language is called in its own
      // script is taken from the registry and is not a per-hospital decision.
      await db
        .insertInto('hospital_language')
        .values({
          hospital_id: fx.hospitalId,
          language_tag: 'or',
          label: 'Odia',
          clinically_reviewed: true,
          audio_available: false,
        })
        .execute();
      await publishConsentNotice(db, fx.hospitalId, 'or');

      const res = await http().get('/v1/kiosk/config').set(headers()).expect(200);
      const odia = res.body.languages.find((l: { tag: string }) => l.tag === 'or');
      expect(odia.label).toBe('ଓଡ଼ିଆ');
    });

    it('offers only enabled departments', async () => {
      await db
        .insertInto('department')
        .values({
          branch_id: fx.branchId,
          code: 'UNA-OPD',
          name: 'Unani OPD',
          ayush_system: 'UNANI',
          enabled: false,
        })
        .execute();

      const res = await http().get('/v1/kiosk/config').set(headers()).expect(200);
      expect(res.body.departments.map((d: { departmentId: string }) => d.departmentId)).toEqual([
        'AYU-OPD',
      ]);
      // A system the hospital has not enabled cannot appear anywhere.
      expect(res.body.ayushSystems).toEqual(['AYURVEDA']);
    });

    it('reports every unbuilt feature as off', async () => {
      const res = await http().get('/v1/kiosk/config').set(headers()).expect(200);
      expect(res.body.features).toEqual({
        abha: false,
        aiSummary: false,
        ocr: false,
        redFlags: false,
        voiceIntake: false,
      });
    });

    it('keeps ABHA off when the hospital has not approved it, whatever the deployment flag says', async () => {
      // The hospital's own approval is a separate gate from the deployment feature flag.
      await db.updateTable('hospital').set({ abha_enabled: false }).execute();
      const res = await http().get('/v1/kiosk/config').set(headers()).expect(200);
      expect(res.body.features.abha).toBe(false);
    });

    it('reports which languages have a published consent notice', async () => {
      const res = await http().get('/v1/kiosk/config').set(headers()).expect(200);
      expect(res.body.contentVersions.consentNotice).toBe('en,hi');
      // 0.0.0 is not a publishable version, so it cannot be mistaken for approved content.
      expect(res.body.contentVersions.questionnaire).toBe('0.0.0');
    });

    it('offers no language at all when no consent notice is published', async () => {
      await db.deleteFrom('governance_version').execute();
      const res = await http().get('/v1/kiosk/config').set(headers()).expect(200);
      // Reviewed labels with no notice would walk a patient to the consent screen and
      // strand them, since there is no cross-language fallback for consent wording.
      expect(res.body.languages).toEqual([]);
      expect(res.body.contentVersions.consentNotice).toBe('UNPUBLISHED');
    });

    it('returns session timings so a hospital can tune them without a new build', async () => {
      const res = await http().get('/v1/kiosk/config').set(headers()).expect(200);
      expect(res.body.session.inactivityWarningSeconds).toBeGreaterThan(0);
      expect(res.body.session.inactivityWipeSeconds).toBeGreaterThan(0);
    });

    it('echoes the correlation id for end-to-end tracing', async () => {
      const res = await http().get('/v1/kiosk/config').set(headers()).expect(200);
      expect(res.headers[CORRELATION_ID_HEADER]).toBe(correlationId);
    });
  });

  describe('session lifecycle', () => {
    const startSession = async (): Promise<string> => {
      const res = await http().post('/v1/kiosk/sessions').set(headers()).expect(201);
      return res.body.sessionId as string;
    };

    it('starts a session and returns its warning and expiry deadlines', async () => {
      const res = await http().post('/v1/kiosk/sessions').set(headers()).expect(201);
      expect(res.body.state).toBe('CREATED');
      expect(new Date(res.body.warnAt).getTime()).toBeGreaterThan(Date.now());
      expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(
        new Date(res.body.warnAt).getTime(),
      );
    });

    it('accepts a reviewed language', async () => {
      const id = await startSession();
      const res = await http()
        .post(`/v1/kiosk/sessions/${id}/language`)
        .set(headers())
        .send({ language: 'hi' })
        .expect(201);
      expect(res.body.state).toBe('LANGUAGE_SELECTED');
    });

    it('refuses a language the hospital has not had reviewed', async () => {
      const id = await startSession();
      // Tamil is configured but unreviewed. Refusing beats silently falling back, which
      // would leave a patient reading a language they did not choose.
      await http()
        .post(`/v1/kiosk/sessions/${id}/language`)
        .set(headers())
        .send({ language: 'ta' })
        .expect(400);
    });

    it('refuses an unknown language', async () => {
      const id = await startSession();
      await http()
        .post(`/v1/kiosk/sessions/${id}/language`)
        .set(headers())
        .send({ language: 'fr' })
        .expect(400);
    });

    it('refuses to end a session without a wipe attestation', async () => {
      const id = await startSession();
      const res = await http()
        .post(`/v1/kiosk/sessions/${id}/end`)
        .set(headers())
        .send({ reason: 'EXIT' })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('refuses to end a session that claims it did not wipe', async () => {
      const id = await startSession();
      await http()
        .post(`/v1/kiosk/sessions/${id}/end`)
        .set(headers())
        .send({ reason: 'EXIT', wiped: false })
        .expect(400);
    });

    it('ends a session that attests it wiped', async () => {
      const id = await startSession();
      const res = await http()
        .post(`/v1/kiosk/sessions/${id}/end`)
        .set(headers())
        .send({ reason: 'EXIT', wiped: true })
        .expect(201);
      expect(res.body.state).toBe('EXITED');
    });

    it('refuses activity on an ended session', async () => {
      const id = await startSession();
      await http()
        .post(`/v1/kiosk/sessions/${id}/end`)
        .set(headers())
        .send({ reason: 'EXIT', wiped: true })
        .expect(201);

      const res = await http().post(`/v1/kiosk/sessions/${id}/activity`).set(headers()).expect(410);
      expect(res.body.code).toBe('SESSION_EXPIRED');
    });

    it('answers an illegal transition with a conflict, not a stack trace', async () => {
      const id = await startSession();
      await http()
        .post(`/v1/kiosk/sessions/${id}/end`)
        .set(headers())
        .send({ reason: 'EXIT', wiped: true })
        .expect(201);

      const res = await http()
        .post(`/v1/kiosk/sessions/${id}/language`)
        .set(headers())
        .send({ language: 'hi' })
        .expect(409);
      expect(res.body.code).toBe('INVALID_STATE_TRANSITION');
      expect(JSON.stringify(res.body)).not.toMatch(/at |\.ts:/);
    });
  });
});
