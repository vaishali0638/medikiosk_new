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

const PLACEHOLDER = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../infra/seed-content/questionnaire.common-core.en.json'),
    'utf8',
  ),
) as Record<string, unknown>;

describe('clinical intake (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let db: Kysely<Database>;
  let fx: Fixture;
  let preCheckinId: string;
  let consentId: string;

  const http = () => request(app.getHttpServer());
  const headers = (): Record<string, string> => ({
    [KIOSK_DEVICE_HEADER]: 'MK-OPD-01',
    [CORRELATION_ID_HEADER]: randomUUID(),
  });

  const publishQuestionnaire = async (payload: unknown = PLACEHOLDER): Promise<void> => {
    await db
      .insertInto('governance_version')
      .values({
        hospital_id: fx.hospitalId,
        content_kind: 'QUESTIONNAIRE',
        content_key: 'common-core/en',
        semver: '0.1.0',
        state: 'PUBLISHED',
        payload: JSON.stringify(payload),
        author_actor_id: 'TEST',
        approvals: JSON.stringify([{ by: 'Dr Test', role: 'CLINICAL_REVIEWER' }]),
        effective_from: new Date(),
      })
      .execute();
  };

  const answer = (body: Record<string, unknown>) =>
    http()
      .post(`/v1/intakes/${preCheckinId}/answers?language=en`)
      .set(headers())
      .send({ source: 'PATIENT_SELECTED', modality: 'TOUCH', language: 'en', ...body });

  const nextQuestionId = async (): Promise<string | null> => {
    const res = await http()
      .get(`/v1/intakes/${preCheckinId}/next?language=en`)
      .set(headers())
      .expect(200);
    return res.body.complete ? null : (res.body.question.id as string);
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
    consentId = consent.id;

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

  describe('the interview', () => {
    beforeEach(publishQuestionnaire);

    it('starts at the chief complaint', async () => {
      expect(await nextQuestionId()).toBe('chiefComplaint');
    });

    it('can be completed entirely by touch', async () => {
      // No AI, no voice, no typing beyond the free-text boxes — the whole core has to be
      // finishable by someone who will only tap.
      let guard = 0;
      let current = await nextQuestionId();
      while (current !== null && guard < 40) {
        await answer({ questionId: current, selectedOptionIds: ['NOT_SURE'] }).expect(201);
        current = await nextQuestionId();
        guard += 1;
      }
      expect(current).toBeNull();
      expect(guard).toBeGreaterThan(5);
    });

    it('follows a branch only when its condition holds', async () => {
      await answer({ questionId: 'chiefComplaint', selectedOptionIds: ['pain'] }).expect(201);
      // `complaintDetail` is only asked when the complaint is "other".
      expect(await nextQuestionId()).toBe('duration');
    });

    it('takes the branch when the condition holds', async () => {
      await answer({ questionId: 'chiefComplaint', selectedOptionIds: ['other'] }).expect(201);
      expect(await nextQuestionId()).toBe('complaintDetail');
    });

    it('reports progress against questions that will actually be asked', async () => {
      await answer({ questionId: 'chiefComplaint', selectedOptionIds: ['pain'] }).expect(201);
      const res = await http()
        .get(`/v1/intakes/${preCheckinId}/next?language=en`)
        .set(headers())
        .expect(200);

      expect(res.body.answeredCount).toBe(1);
      // A skipped branch must not make the bar look stuck.
      expect(res.body.totalApplicable).toBeLessThan((PLACEHOLDER['nodes'] as unknown[]).length);
    });

    it('carries the questionnaire version on every response', async () => {
      const res = await http()
        .get(`/v1/intakes/${preCheckinId}/next?language=en`)
        .set(headers())
        .expect(200);
      expect(res.body.questionnaireVersion).toBe('0.1.0-placeholder');
    });
  });

  describe('answers', () => {
    beforeEach(publishQuestionnaire);

    it('records the version, source and modality with every answer', async () => {
      await answer({
        questionId: 'chiefComplaint',
        selectedOptionIds: ['pain'],
        source: 'PATIENT_SELECTED',
        modality: 'TOUCH',
      }).expect(201);

      const row = await db
        .selectFrom('questionnaire_response')
        .selectAll()
        .executeTakeFirstOrThrow();

      expect(row.questionnaire_ver).toBe('0.1.0-placeholder');
      expect(row.source).toBe('PATIENT_SELECTED');
      expect(row.modality).toBe('TOUCH');
      expect(row.language_tag).toBe('en');
    });

    it('appends a revision rather than overwriting', async () => {
      await answer({ questionId: 'chiefComplaint', selectedOptionIds: ['pain'] }).expect(201);
      const second = await answer({
        questionId: 'chiefComplaint',
        selectedOptionIds: ['fever'],
      }).expect(201);

      expect(second.body.revision).toBe(2);
      // The doctor can see that the patient changed their mind, which matters when the
      // change is "actually I do take that medicine".
      const rows = await db.selectFrom('questionnaire_response').selectAll().execute();
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.revision).sort()).toEqual([1, 2]);
    });

    it('accepts every non-committal answer the question offers', async () => {
      for (const value of ['NOT_SURE', 'PREFER_TO_DISCUSS_WITH_DOCTOR', 'NOT_APPLICABLE']) {
        await answer({ questionId: 'chiefComplaint', selectedOptionIds: [value] }).expect(201);
      }
    });

    it('refuses a non-committal answer mixed with a substantive one', async () => {
      // "Not sure, and also knee pain" is not a coherent record.
      await answer({
        questionId: 'chiefComplaint',
        selectedOptionIds: ['NOT_SURE', 'pain'],
      }).expect(400);
    });

    it('refuses an option the published question does not offer', async () => {
      await answer({
        questionId: 'chiefComplaint',
        selectedOptionIds: ['something-invented'],
      }).expect(400);
    });

    it('refuses an answer to a question not in this version', async () => {
      // A stored answer whose question cannot be reconstructed is not a clinical record.
      await answer({ questionId: 'notAQuestion', selectedOptionIds: ['x'] }).expect(400);
    });

    it('requires source and modality rather than defaulting them', async () => {
      await http()
        .post(`/v1/intakes/${preCheckinId}/answers?language=en`)
        .set(headers())
        .send({ questionId: 'chiefComplaint', selectedOptionIds: ['pain'], language: 'en' })
        .expect(400);
    });
  });

  describe('sensitive questions', () => {
    beforeEach(publishQuestionnaire);

    it('every sensitive question carries its explanation', async () => {
      const nodes = PLACEHOLDER['nodes'] as Array<{ question: Record<string, unknown> }>;
      const sensitive = nodes.filter((n) => n.question['sensitive'] === true);

      expect(sensitive.length).toBeGreaterThan(0);
      for (const node of sensitive) {
        expect(node.question['sensitiveExplanation']).toEqual(expect.any(String));
        // Declining must be as available here as anywhere else.
        expect(node.question['nonCommittal']).toContain('PREFER_TO_DISCUSS_WITH_DOCTOR');
      }
    });
  });

  describe('consent', () => {
    beforeEach(publishQuestionnaire);

    it('refuses to serve a question once consent is withdrawn', async () => {
      await answer({ questionId: 'chiefComplaint', selectedOptionIds: ['pain'] }).expect(201);

      await db
        .updateTable('consent')
        .set({ state: 'REVOKED', revoked_at: new Date() })
        .where('id', '=', consentId)
        .execute();

      // Consent is re-checked on every call, not once at the start: a patient can
      // withdraw mid-intake.
      await http().get(`/v1/intakes/${preCheckinId}/next?language=en`).set(headers()).expect(403);
      await answer({ questionId: 'duration', selectedOptionIds: ['today'] }).expect(403);
    });
  });

  describe('review', () => {
    beforeEach(publishQuestionnaire);

    it('returns structured answers in questionnaire order with their provenance', async () => {
      await answer({ questionId: 'chiefComplaint', selectedOptionIds: ['pain'] }).expect(201);
      await answer({ questionId: 'duration', selectedOptionIds: ['1to7days'] }).expect(201);

      const res = await http()
        .get(`/v1/intakes/${preCheckinId}/answers?language=en`)
        .set(headers())
        .expect(200);

      const answered = res.body.items.filter((i: { answered: boolean }) => i.answered);
      expect(answered[0].questionId).toBe('chiefComplaint');
      expect(answered[0].labels).toEqual(['Pain']);
      expect(answered[0].source).toBe('PATIENT_SELECTED');
      expect(answered[1].questionId).toBe('duration');
      expect(res.body.complete).toBe(false);
    });

    it('reports the latest revision only', async () => {
      await answer({ questionId: 'chiefComplaint', selectedOptionIds: ['pain'] }).expect(201);
      await answer({ questionId: 'chiefComplaint', selectedOptionIds: ['fever'] }).expect(201);

      const res = await http()
        .get(`/v1/intakes/${preCheckinId}/answers?language=en`)
        .set(headers())
        .expect(200);
      const item = res.body.items.find(
        (i: { questionId: string }) => i.questionId === 'chiefComplaint',
      );
      expect(item.labels).toEqual(['Fever']);
      expect(item.revision).toBe(2);
    });
  });

  describe('governed content', () => {
    it('refuses when no questionnaire is published for the language', async () => {
      await publishQuestionnaire();
      await http().get(`/v1/intakes/${preCheckinId}/next?language=hi`).set(headers()).expect(400);
    });

    it('fails loudly on a structurally invalid release', async () => {
      // Branching on a question asked later would strand a patient mid-interview.
      await publishQuestionnaire({
        key: 'common-core',
        version: '0.1.0-broken',
        title: 'Broken',
        nodes: [
          {
            question: {
              id: 'a',
              type: 'SINGLE_SELECT',
              prompt: 'A',
              options: [{ id: 'yes', label: 'Yes' }],
              sensitive: false,
              nonCommittal: ['NOT_SURE'],
            },
            askWhen: { kind: 'EQUALS', questionId: 'b', value: 'yes' },
          },
          {
            question: {
              id: 'b',
              type: 'SINGLE_SELECT',
              prompt: 'B',
              options: [{ id: 'yes', label: 'Yes' }],
              sensitive: false,
              nonCommittal: ['NOT_SURE'],
            },
          },
        ],
      });

      await http().get(`/v1/intakes/${preCheckinId}/next?language=en`).set(headers()).expect(500);
    });

    it('does not serve a draft questionnaire', async () => {
      await db
        .insertInto('governance_version')
        .values({
          hospital_id: fx.hospitalId,
          content_kind: 'QUESTIONNAIRE',
          content_key: 'common-core/en',
          semver: '0.2.0',
          state: 'DRAFT',
          payload: JSON.stringify(PLACEHOLDER),
          author_actor_id: 'TEST',
        })
        .execute();

      await http().get(`/v1/intakes/${preCheckinId}/next?language=en`).set(headers()).expect(400);
    });
  });
});
