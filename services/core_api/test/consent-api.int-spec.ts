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
import { createTestDb, seedFixture, truncateAll, type Fixture } from './db-fixture';

/** A minimal but schema-valid published notice. */
function noticePayload(language: string, version = 'v1.0'): Record<string, unknown> {
  return {
    version,
    title: language === 'hi' ? 'गोपनीयता और सहमति' : 'Privacy and consent',
    collectedItems: ['Basic patient details', 'Health information'],
    purpose: 'OPD clinical intake and consultation at this hospital',
    dataCategories: ['demographics', 'clinical-history'],
    fullText: 'Full notice text for tests.',
    audioAvailable: false,
  };
}

describe('consent API (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let db: Kysely<Database>;
  let fx: Fixture;

  const correlationId = randomUUID();
  const http = () => request(app.getHttpServer());
  const headers = (): Record<string, string> => ({
    [KIOSK_DEVICE_HEADER]: 'MK-OPD-01',
    [CORRELATION_ID_HEADER]: correlationId,
  });

  const publishNotice = async (language: string, version = 'v1.0'): Promise<void> => {
    await db
      .insertInto('governance_version')
      .values({
        hospital_id: fx.hospitalId,
        content_kind: 'CONSENT_NOTICE',
        content_key: `consent-notice/${language}`,
        semver: '1.0.0',
        state: 'PUBLISHED',
        published_by_user_id: 'SEED',
        published_at: new Date(),
        payload: JSON.stringify(noticePayload(language, version)),
        author_actor_id: 'TEST',
        approvals: JSON.stringify([{ by: 'Dr Test', role: 'CLINICAL_REVIEWER' }]),
        effective_from: new Date(),
      })
      .execute();
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
    // The fixture publishes an English notice; these tests publish their own, so start clean.
    await db.deleteFrom('governance_version').execute();
    await db
      .insertInto('hospital_language')
      .values({
        hospital_id: fx.hospitalId,
        language_tag: 'hi',
        label: 'हिन्दी',
        clinically_reviewed: true,
        audio_available: false,
      })
      .execute();
  });

  describe('GET /v1/consents/notice', () => {
    it('returns the published notice for a language', async () => {
      await publishNotice('en');
      const res = await http().get('/v1/consents/notice?language=en').set(headers()).expect(200);

      expect(res.body.version).toBe('v1.0');
      expect(res.body.language).toBe('en');
      expect(res.body.collectedItems.length).toBeGreaterThan(0);
      expect(res.body.purpose).toContain('OPD');
    });

    it('names who approved it, so the screen can be traced to a sign-off', async () => {
      await publishNotice('en');
      const res = await http().get('/v1/consents/notice?language=en').set(headers()).expect(200);
      expect(res.body.approvedBy).toEqual(['Dr Test']);
    });

    it('refuses rather than falling back to another language', async () => {
      await publishNotice('en');
      // Serving English wording to someone who chose Hindi is not consent.
      const res = await http().get('/v1/consents/notice?language=hi').set(headers()).expect(403);
      expect(res.body.code).toBe('CONSENT_REQUIRED');
      expect(JSON.stringify(res.body)).not.toContain('Privacy and consent');
    });

    it('requires a language', async () => {
      await http().get('/v1/consents/notice').set(headers()).expect(400);
    });

    it('does not serve a draft notice', async () => {
      await db
        .insertInto('governance_version')
        .values({
          hospital_id: fx.hospitalId,
          content_kind: 'CONSENT_NOTICE',
          content_key: 'consent-notice/en',
          semver: '2.0.0',
          state: 'DRAFT',
          payload: JSON.stringify(noticePayload('en', 'v2.0')),
          author_actor_id: 'TEST',
        })
        .execute();

      await http().get('/v1/consents/notice?language=en').set(headers()).expect(403);
    });

    it('fails loudly on a malformed published notice rather than half-rendering it', async () => {
      await db
        .insertInto('governance_version')
        .values({
          hospital_id: fx.hospitalId,
          content_kind: 'CONSENT_NOTICE',
          content_key: 'consent-notice/en',
          semver: '1.0.0',
          state: 'PUBLISHED',
          published_by_user_id: 'SEED',
          published_at: new Date(),
          // Missing purpose, fullText and dataCategories.
          payload: JSON.stringify({ version: 'v1.0', title: 'Broken' }),
          author_actor_id: 'TEST',
        })
        .execute();

      const res = await http().get('/v1/consents/notice?language=en').set(headers()).expect(500);
      expect(res.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /v1/consents', () => {
    it('records a grant against the published notice version', async () => {
      await publishNotice('en', 'v1.0');
      const res = await http()
        .post('/v1/consents')
        .set(headers())
        .send({ language: 'en', decision: 'GRANTED' })
        .expect(201);

      expect(res.body.status).toBe('GRANTED');
      expect(res.body.noticeVersion).toBe('v1.0');
      // Purpose and categories come from the notice, not from the client.
      expect(res.body.purpose).toContain('OPD');
      expect(res.body.dataCategories).toEqual(['demographics', 'clinical-history']);
    });

    it('takes the notice version from the server, not the client', async () => {
      await publishNotice('en', 'v1.0');
      const res = await http()
        .post('/v1/consents')
        .set(headers())
        // A stale kiosk claiming an older version must not be believed.
        .send({ language: 'en', decision: 'GRANTED', noticeVersion: 'v0.1', purpose: 'anything' })
        .expect(201);

      expect(res.body.noticeVersion).toBe('v1.0');
      expect(res.body.purpose).toContain('OPD');
    });

    it('creates a provisional patient, since identity is not yet known', async () => {
      await publishNotice('en');
      const res = await http()
        .post('/v1/consents')
        .set(headers())
        .send({ language: 'en', decision: 'GRANTED' })
        .expect(201);

      const patient = await db
        .selectFrom('patient')
        .selectAll()
        .where('id', '=', res.body.patientId)
        .executeTakeFirstOrThrow();

      expect(patient.provisional).toBe(true);
      expect(patient.full_name).toBeNull();
    });

    it('records a decline rather than discarding it', async () => {
      await publishNotice('en');
      const res = await http()
        .post('/v1/consents')
        .set(headers())
        .send({ language: 'en', decision: 'DECLINED' })
        .expect(201);

      expect(res.body.status).toBe('DECLINED');
    });

    it('refuses when no notice is published in that language', async () => {
      const res = await http()
        .post('/v1/consents')
        .set(headers())
        .send({ language: 'hi', decision: 'GRANTED' })
        .expect(403);
      expect(res.body.code).toBe('CONSENT_REQUIRED');
    });

    it('rejects a decision that is neither grant nor decline', async () => {
      await publishNotice('en');
      await http()
        .post('/v1/consents')
        .set(headers())
        .send({ language: 'en', decision: 'MAYBE' })
        .expect(400);
    });

    it('audits the decision with the notice version and language', async () => {
      await publishNotice('en');
      const res = await http()
        .post('/v1/consents')
        .set(headers())
        .send({ language: 'en', decision: 'GRANTED' })
        .expect(201);

      const event = await db
        .selectFrom('audit_event')
        .selectAll()
        .where('entity_id', '=', res.body.consentId)
        .executeTakeFirstOrThrow();

      expect(event.action).toBe('CONSENT_GRANTED');
      expect(event.detail).toMatchObject({ noticeVersion: 'v1.0', language: 'en' });
    });
  });

  describe('session integration', () => {
    const startSession = async (): Promise<string> => {
      const res = await http().post('/v1/kiosk/sessions').set(headers()).expect(201);
      await http()
        .post(`/v1/kiosk/sessions/${res.body.sessionId}/language`)
        .set(headers())
        .send({ language: 'en' })
        .expect(201);
      return res.body.sessionId as string;
    };

    it('advances the session to CONSENT_GRANTED on a grant', async () => {
      await publishNotice('en');
      const sessionId = await startSession();

      await http()
        .post(`/v1/consents?sessionId=${sessionId}`)
        .set(headers())
        .send({ language: 'en', decision: 'GRANTED' })
        .expect(201);

      const session = await db
        .selectFrom('kiosk_session')
        .selectAll()
        .where('id', '=', sessionId)
        .executeTakeFirstOrThrow();

      expect(session.state).toBe('CONSENT_GRANTED');
      expect(session.patient_id).not.toBeNull();
    });

    it('ends the session on a decline — intake does not continue', async () => {
      await publishNotice('en');
      const sessionId = await startSession();

      await http()
        .post(`/v1/consents?sessionId=${sessionId}`)
        .set(headers())
        .send({ language: 'en', decision: 'DECLINED' })
        .expect(201);

      const session = await db
        .selectFrom('kiosk_session')
        .selectAll()
        .where('id', '=', sessionId)
        .executeTakeFirstOrThrow();

      expect(session.state).toBe('EXITED');
      expect(session.wiped_at).not.toBeNull();
      // The artefact survives; only the session ends.
      const consents = await db.selectFrom('consent').selectAll().execute();
      expect(consents).toHaveLength(1);
      expect(consents[0]?.state).toBe('DECLINED');
    });
  });

  describe('revocation', () => {
    it('withdraws a granted consent', async () => {
      await publishNotice('en');
      const granted = await http()
        .post('/v1/consents')
        .set(headers())
        .send({ language: 'en', decision: 'GRANTED' })
        .expect(201);

      const res = await http()
        .post(`/v1/consents/${granted.body.consentId}/revoke`)
        .set(headers())
        .send({})
        .expect(201);

      expect(res.body.status).toBe('REVOKED');
    });

    it('refuses to revoke a consent belonging to another hospital', async () => {
      await publishNotice('en');
      const other = await db
        .insertInto('hospital')
        .values({ code: 'HOSP-OTHER', name: 'Other Hospital' })
        .returningAll()
        .executeTakeFirstOrThrow();
      const patient = await db
        .insertInto('patient')
        .values({ hospital_id: other.id, provisional: true })
        .returningAll()
        .executeTakeFirstOrThrow();
      const foreign = await db
        .insertInto('consent')
        .values({
          patient_id: patient.id,
          hospital_id: other.id,
          purpose: 'OPD clinical intake and consultation',
          data_categories: ['demographics'],
          language_tag: 'en',
          notice_version: 'v1.0',
          state: 'GRANTED',
          capture_method: 'KIOSK_TOUCH',
          valid_until: new Date(Date.now() + 86_400_000),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await http().post(`/v1/consents/${foreign.id}/revoke`).set(headers()).send({}).expect(400);
    });

    it('does not expose a consent from another hospital', async () => {
      await http()
        .get('/v1/consents/00000000-0000-4000-8000-000000000000')
        .set(headers())
        .expect(400);
    });
  });

  describe('kiosk config', () => {
    it('offers only languages that have a published consent notice', async () => {
      await publishNotice('en');
      // Hindi is clinically reviewed but has no notice, so offering it would walk a
      // patient to the consent screen and strand them.
      const res = await http().get('/v1/kiosk/config').set(headers()).expect(200);
      expect(res.body.languages.map((l: { tag: string }) => l.tag)).toEqual(['en']);
    });

    it('offers both once both notices are published', async () => {
      await publishNotice('en');
      await publishNotice('hi');
      const res = await http().get('/v1/kiosk/config').set(headers()).expect(200);
      expect(res.body.languages.map((l: { tag: string }) => l.tag).sort()).toEqual(['en', 'hi']);
    });

    it('offers nothing when no notice is published at all', async () => {
      const res = await http().get('/v1/kiosk/config').set(headers()).expect(200);
      expect(res.body.languages).toEqual([]);
      expect(res.body.contentVersions.consentNotice).toBe('UNPUBLISHED');
    });
  });
});
