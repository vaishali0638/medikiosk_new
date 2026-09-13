import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

const CORE = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../infra/seed-content/questionnaire.common-core.en.json'),
    'utf8',
  ),
) as Record<string, unknown>;

/**
 * A module with real questions, used only to exercise composition.
 *
 * Deliberately generic — "Section one", "Section two" — rather than plausible-looking
 * Ayurveda content. A fixture that read like a real Prakriti assessment would end up
 * copied into a seed file by someone in a hurry, and this repository must not contain
 * clinical content no practitioner wrote.
 */
const TEST_MODULE = {
  key: 'ayurveda',
  version: '1.0.0',
  title: 'Test module (not clinical content)',
  nodes: [
    {
      question: {
        id: 'moduleQuestionOne',
        type: 'SINGLE_SELECT',
        prompt: 'Placeholder module question one',
        options: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        sensitive: false,
        nonCommittal: ['NOT_SURE', 'PREFER_TO_DISCUSS_WITH_DOCTOR', 'NOT_APPLICABLE'],
      },
    },
  ],
};

const FOUR_APPROVALS = [
  { role: 'AUTHOR', by: 'Dr A Sharma', qualification: 'BAMS', at: new Date().toISOString() },
  {
    role: 'CLINICAL_REVIEWER',
    by: 'Dr B Nair',
    qualification: 'BAMS',
    at: new Date().toISOString(),
  },
  { role: 'TRANSLATION_REVIEWER', by: 'C Iyer', at: new Date().toISOString() },
  { role: 'SAFETY_REVIEWER', by: 'Dr D Rao', at: new Date().toISOString() },
];

describe('AYUSH modules (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let db: Kysely<Database>;
  let fx: Fixture;
  let preCheckinId: string;

  const http = () => request(app.getHttpServer());
  const headers = (): Record<string, string> => ({
    [KIOSK_DEVICE_HEADER]: 'MK-OPD-01',
    [CORRELATION_ID_HEADER]: randomUUID(),
  });

  const publishCore = () =>
    db
      .insertInto('governance_version')
      .values({
        hospital_id: fx.hospitalId,
        content_kind: 'QUESTIONNAIRE',
        content_key: 'common-core/en',
        semver: '0.1.0',
        state: 'PUBLISHED',
        payload: JSON.stringify(CORE),
        author_actor_id: 'TEST',
        approvals: JSON.stringify([{ by: 'Dr Test', role: 'CLINICAL_REVIEWER' }]),
        effective_from: new Date(),
      })
      .execute();

  const publishModule = (
    payload: unknown = TEST_MODULE,
    approvals: unknown[] = FOUR_APPROVALS,
    key = 'ayurveda/en',
  ) =>
    db
      .insertInto('governance_version')
      .values({
        hospital_id: fx.hospitalId,
        content_kind: 'AYUSH_MODULE',
        content_key: key,
        semver: '1.0.0',
        state: 'PUBLISHED',
        payload: JSON.stringify(payload),
        author_actor_id: 'TEST',
        approvals: JSON.stringify(approvals),
        effective_from: new Date(),
      })
      .execute();

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
    await db.deleteFrom('governance_version').execute();

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
        state: 'DRAFT',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    preCheckinId = pre.id;
  });

  describe('the approval gate', () => {
    it('refuses to publish a module with fewer than four approvals', async () => {
      // The database backstop under the application rule: clinical content reaching a
      // patient without review is what this phase exists to prevent, so both refuse.
      await expect(
        publishModule(TEST_MODULE, [FOUR_APPROVALS[0], FOUR_APPROVALS[1]]),
      ).rejects.toThrow(/governance_version_ayush_approval/);
    });

    it('refuses to publish a module with no effective date', async () => {
      await expect(
        db
          .insertInto('governance_version')
          .values({
            hospital_id: fx.hospitalId,
            content_kind: 'AYUSH_MODULE',
            content_key: 'ayurveda/en',
            semver: '1.0.0',
            state: 'PUBLISHED',
            payload: JSON.stringify(TEST_MODULE),
            author_actor_id: 'TEST',
            approvals: JSON.stringify(FOUR_APPROVALS),
          })
          .execute(),
      ).rejects.toThrow(/governance_version_clinical_approval/);
    });

    it('allows a draft module with no approvals at all', async () => {
      // Unapproved content may exist — it just cannot be live.
      await db
        .insertInto('governance_version')
        .values({
          hospital_id: fx.hospitalId,
          content_kind: 'AYUSH_MODULE',
          content_key: 'ayurveda/en',
          semver: '0.1.0',
          state: 'DRAFT',
          payload: JSON.stringify(TEST_MODULE),
          author_actor_id: 'TEST',
          approvals: JSON.stringify([]),
        })
        .execute();

      const rows = await db.selectFrom('governance_version').selectAll().execute();
      expect(rows).toHaveLength(1);
    });
  });

  describe('system availability', () => {
    it('offers nothing when no module is published', async () => {
      await publishCore();
      // The fixture has an enabled Ayurveda department, but no approved module.
      const res = await http().get('/v1/intakes/ayush-systems').set(headers()).expect(200);
      expect(res.body.systems).toEqual([]);
    });

    it('offers a system once its module is published', async () => {
      await publishCore();
      await publishModule();
      const res = await http().get('/v1/intakes/ayush-systems').set(headers()).expect(200);
      expect(res.body.systems).toEqual(['AYURVEDA']);
    });

    it('does not offer a system whose department is disabled', async () => {
      await publishCore();
      await publishModule();
      await db.updateTable('department').set({ enabled: false }).execute();

      const res = await http().get('/v1/intakes/ayush-systems').set(headers()).expect(200);
      expect(res.body.systems).toEqual([]);
    });

    it('does not offer a system whose module is published in another language', async () => {
      await publishCore();
      await publishModule(TEST_MODULE, FOUR_APPROVALS, 'ayurveda/hi');
      const res = await http()
        .get('/v1/intakes/ayush-systems?language=en')
        .set(headers())
        .expect(200);
      expect(res.body.systems).toEqual([]);
    });
  });

  describe('composition', () => {
    it('serves the core alone when no module is approved yet', async () => {
      await publishCore();
      const res = await http()
        .get(`/v1/intakes/${preCheckinId}/next?language=en`)
        .set(headers())
        .expect(200);

      // A hospital may run an Ayurveda OPD long before its module has been reviewed. The
      // right behaviour is to collect the history every clinician needs, not refuse.
      expect(res.body.ayushModule).toBeNull();
      expect(res.body.questionnaireVersion).toBe('0.1.0-placeholder');
    });

    it('appends the module after the core once it is approved', async () => {
      await publishCore();
      await publishModule();

      const res = await http()
        .get(`/v1/intakes/${preCheckinId}/next?language=en`)
        .set(headers())
        .expect(200);

      expect(res.body.ayushModule).toBe('ayurveda');
      expect(res.body.questionnaireVersion).toBe('0.1.0-placeholder+ayurveda.1.0.0');
      // Core first: an intake abandoned halfway still carries the universal part.
      expect(res.body.question.id).toBe('chiefComplaint');
    });

    it('records both versions on every answer', async () => {
      await publishCore();
      await publishModule();

      await http()
        .post(`/v1/intakes/${preCheckinId}/answers?language=en`)
        .set(headers())
        .send({
          questionId: 'chiefComplaint',
          selectedOptionIds: ['pain'],
          source: 'PATIENT_SELECTED',
          modality: 'TOUCH',
          language: 'en',
        })
        .expect(201);

      const row = await db
        .selectFrom('questionnaire_response')
        .selectAll()
        .executeTakeFirstOrThrow();
      // The answer must be reconstructable from what the patient was actually shown,
      // which was the composition rather than either half.
      expect(row.questionnaire_ver).toBe('0.1.0-placeholder+ayurveda.1.0.0');
    });

    it('reaches the module questions after the core is answered', async () => {
      await publishCore();
      await publishModule();

      let guard = 0;
      let current: string | null = null;
      do {
        const res = await http()
          .get(`/v1/intakes/${preCheckinId}/next?language=en`)
          .set(headers())
          .expect(200);
        current = res.body.complete ? null : (res.body.question.id as string);
        if (current === 'moduleQuestionOne') break;
        if (current === null) break;
        await http()
          .post(`/v1/intakes/${preCheckinId}/answers?language=en`)
          .set(headers())
          .send({
            questionId: current,
            selectedOptionIds: ['NOT_SURE'],
            source: 'PATIENT_SELECTED',
            modality: 'TOUCH',
            language: 'en',
          })
          .expect(201);
        guard += 1;
      } while (guard < 40);

      expect(current).toBe('moduleQuestionOne');
    });

    it('fails loudly when a module reuses a core question id', async () => {
      await publishCore();
      await publishModule({
        ...TEST_MODULE,
        nodes: [
          {
            question: {
              id: 'chiefComplaint',
              type: 'SINGLE_SELECT',
              prompt: 'Colliding',
              options: [{ id: 'a', label: 'A' }],
              sensitive: false,
              nonCommittal: ['NOT_SURE'],
            },
          },
        ],
      });

      // Two meanings for one stored answer is not something to resolve silently.
      await http().get(`/v1/intakes/${preCheckinId}/next?language=en`).set(headers()).expect(500);
    });

    it('includes the module in the review screen', async () => {
      await publishCore();
      await publishModule();

      const res = await http()
        .get(`/v1/intakes/${preCheckinId}/answers?language=en`)
        .set(headers())
        .expect(200);

      expect(res.body.ayushModule).toBe('ayurveda');
      expect(
        res.body.items.some((i: { questionId: string }) => i.questionId === 'moduleQuestionOne'),
      ).toBe(true);
    });
  });

  describe('the shipped module skeletons', () => {
    it('contain no questions at all', () => {
      // The specification forbids a model inventing clinical protocol. These files are
      // section headings transcribed from it, and nothing more.
      for (const key of [
        'ayurveda',
        'unani',
        'siddha',
        'yoga-naturopathy',
        'sowa-rigpa',
        'homoeopathy',
      ]) {
        const skeleton = JSON.parse(
          readFileSync(
            resolve(__dirname, `../../../infra/seed-content/ayush-module.${key}.en.SKELETON.json`),
            'utf8',
          ),
        ) as { sections: Array<{ questions: unknown[]; status: string }> };

        expect(skeleton.sections.length).toBeGreaterThan(0);
        for (const section of skeleton.sections) {
          expect(section.questions).toEqual([]);
          expect(section.status).toBe('AWAITING_AUTHORSHIP');
        }
      }
    });

    it('are not published by the seed', async () => {
      const published = await db
        .selectFrom('governance_version')
        .selectAll()
        .where('content_kind', '=', 'AYUSH_MODULE')
        .execute();
      expect(published).toEqual([]);
    });
  });
});
