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
import { NO_DIAGNOSIS_STATEMENT, PROVENANCE_LABELS } from '@medikiosk/terminology';
import type { Database } from '../src/db/database.types';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/domain-exception.filter';
import { DRAFT_GENERATOR, type DraftGenerator } from '../src/summary/generator.adapter';
import { createTestDb, seedFixture, truncateAll, type Fixture } from './db-fixture';

const PLACEHOLDER = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../infra/seed-content/questionnaire.common-core.en.json'),
    'utf8',
  ),
) as Record<string, unknown>;

/**
 * A generator whose output a test dictates.
 *
 * This is how the safety gate gets exercised against something that behaves like a model:
 * it can return well-formed prose, a diagnosis, an invented condition, malformed JSON, or
 * nothing at all, and the system's response to each is the thing under test.
 */
class ScriptedGenerator implements DraftGenerator {
  readonly name = 'scripted';
  readonly version = 'test-1';
  calls = 0;
  /** What to return; a thrown error models an unavailable generator. */
  next: (() => unknown) | null = null;

  generate(): Promise<unknown> {
    this.calls += 1;
    if (!this.next) return Promise.reject(new Error('unavailable'));
    return Promise.resolve(this.next());
  }
}

describe('patient review and safe draft (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let db: Kysely<Database>;
  let fx: Fixture;
  let preCheckinId: string;
  let generator: ScriptedGenerator;

  const http = () => request(app.getHttpServer());
  const headers = (): Record<string, string> => ({
    [KIOSK_DEVICE_HEADER]: 'MK-OPD-01',
    [CORRELATION_ID_HEADER]: randomUUID(),
  });

  const publishQuestionnaire = async (): Promise<void> => {
    await db
      .insertInto('governance_version')
      .values({
        hospital_id: fx.hospitalId,
        content_kind: 'QUESTIONNAIRE',
        content_key: 'common-core/en',
        semver: '0.1.0',
        state: 'PUBLISHED',
        payload: JSON.stringify(PLACEHOLDER),
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

  /** Answers enough of the interview that a draft has something to say. */
  const answerSome = async (): Promise<void> => {
    // "other" is what opens the free-text follow-up, so this exercises both a selected
    // option and a spoken description.
    await answer({ questionId: 'chiefComplaint', selectedOptionIds: ['other'] }).expect(201);
    await answer({
      questionId: 'complaintDetail',
      value: 'knee pain for two months',
      source: 'PATIENT_REPORTED',
      modality: 'VOICE',
      selectedOptionIds: [],
    }).expect(201);
  };

  const submit = (body: Record<string, unknown> = {}) =>
    http()
      .post(`/v1/precheckins/${preCheckinId}/submit-intake`)
      .set(headers())
      .send({ reviewConfirmed: true, language: 'en', ...body });

  beforeAll(async () => {
    db = await createTestDb();
    generator = new ScriptedGenerator();
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DRAFT_GENERATOR)
      .useValue(generator)
      .compile();
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
    generator.next = null;
    generator.calls = 0;

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

    await publishQuestionnaire();
  });

  describe('the review screen', () => {
    it('shows the patient their own answers with a provenance label on each', async () => {
      await answerSome();

      const res = await http()
        .get(`/v1/precheckins/${preCheckinId}/review?language=en`)
        .set(headers())
        .expect(200);

      expect(res.body.heading).toBe('Your information for the doctor');
      const detail = res.body.items.find(
        (i: { questionId: string }) => i.questionId === 'complaintDetail',
      );
      expect(detail.display).toBe('knee pain for two months');
      expect(detail.provenance).toBe(PROVENANCE_LABELS.PATIENT_REPORTED);

      const complaint = res.body.items.find(
        (i: { questionId: string }) => i.questionId === 'chiefComplaint',
      );
      expect(complaint.provenance).toBe(PROVENANCE_LABELS.PATIENT_SELECTED);
    });

    it('gives an unanswered question no provenance at all', async () => {
      await answerSome();

      const res = await http()
        .get(`/v1/precheckins/${preCheckinId}/review?language=en`)
        .set(headers())
        .expect(200);

      const unanswered = res.body.items.find((i: { answered: boolean }) => !i.answered);
      // Labelling a question the patient never answered "patient-reported" attributes
      // something to them that they did not say.
      expect(unanswered.provenance).toBeNull();
    });

    it('shows nothing derived — no draft, no narrative, no diagnosis', async () => {
      await answerSome();
      await submit().expect(201);

      const res = await http()
        .get(`/v1/precheckins/${preCheckinId}/review?language=en`)
        .set(headers())
        .expect(200);

      // The patient checks what they said. A generated narrative on this screen would
      // invite them to approve a draft they are not in a position to judge.
      expect(res.body).not.toHaveProperty('narrative');
      expect(res.body).not.toHaveProperty('sections');
      expect(JSON.stringify(res.body)).not.toContain('DRAFT');
    });

    it('marks every answer editable, because Edit is not decorative', async () => {
      await answerSome();

      const res = await http()
        .get(`/v1/precheckins/${preCheckinId}/review?language=en`)
        .set(headers())
        .expect(200);

      // A patient who spots a wrong answer and cannot fix it submits something they know
      // is wrong, or walks away.
      expect(res.body.items.every((i: { editable: boolean }) => i.editable)).toBe(true);
    });
  });

  describe('submission requires review', () => {
    it('refuses without confirmation', async () => {
      await answerSome();
      await submit({ reviewConfirmed: false }).expect(400);

      const rows = await db.selectFrom('intake_submission').selectAll().execute();
      expect(rows).toHaveLength(0);
    });

    it('refuses when confirmation is simply absent', async () => {
      await answerSome();
      await http()
        .post(`/v1/precheckins/${preCheckinId}/submit-intake`)
        .set(headers())
        .send({ language: 'en' })
        .expect(400);
    });

    it('the database refuses an unconfirmed row even if the check were bypassed', async () => {
      // The application check gives a useful error; this constraint is the actual control.
      await expect(
        db
          .insertInto('intake_submission')
          .values({
            pre_checkin_id: preCheckinId,
            consent_id: (await db.selectFrom('consent').select('id').executeTakeFirstOrThrow()).id,
            questionnaire_key: 'common-core',
            questionnaire_version: '0.1.0-placeholder',
            language_tag: 'en',
            review_confirmed: false,
            reviewed_at: new Date(),
            answer_revisions: JSON.stringify({}) as never,
            corrections: JSON.stringify([]) as never,
            correlation_id: randomUUID(),
          })
          .execute(),
      ).rejects.toThrow();
    });

    it('records what the patient confirmed, per master prompt §18', async () => {
      await answerSome();
      await submit().expect(201);

      const row = await db.selectFrom('intake_submission').selectAll().executeTakeFirstOrThrow();
      expect(row.review_confirmed).toBe(true);
      expect(row.questionnaire_version).toBe('0.1.0-placeholder');
      expect(row.language_tag).toBe('en');
      expect(row.consent_id).toBeTruthy();
      expect(row.kiosk_device_id).toBeTruthy();
      // The revision each answer was at when they confirmed, so a later edit cannot
      // rewrite what they actually reviewed.
      expect(row.answer_revisions).toMatchObject({ chiefComplaint: 1 });
    });

    it('is idempotent: pressing the button twice submits once', async () => {
      await answerSome();
      const first = await submit().expect(201);
      const second = await submit().expect(201);

      expect(second.body.submissionId).toBe(first.body.submissionId);
      expect(second.body.alreadySubmitted).toBe(true);
      expect(await db.selectFrom('intake_submission').selectAll().execute()).toHaveLength(1);
    });
  });

  describe('the draft a clinician reads', () => {
    it('is produced from the rules when no model is available', async () => {
      await answerSome();
      const res = await submit().expect(201);

      expect(res.body.generator).toBe('DETERMINISTIC');
      expect(res.body.fellBackToRules).toBe(true);
      expect(res.body.draftLabel).toBe('AI-assisted pre-consultation draft — not verified');
    });

    it('always carries the unverified label, never a verified one', async () => {
      await answerSome();
      await submit().expect(201);

      const res = await http()
        .get(`/v1/precheckins/${preCheckinId}/draft`)
        .set(headers())
        .expect(200);

      expect(res.body.provenance).toBe(PROVENANCE_LABELS.AI_ASSISTED_DRAFT);
      expect(res.body.narrative).toContain(NO_DIAGNOSIS_STATEMENT);
    });

    it('cannot be labelled clinician-verified without a clinician', async () => {
      await answerSome();
      await submit().expect(201);

      // The label is not a field the application decides. Setting it without a named
      // clinician and a timestamp is refused by the database.
      await expect(
        db
          .updateTable('clinical_summary')
          .set({ provenance_label: PROVENANCE_LABELS.CLINICIAN_VERIFIED })
          .where('pre_checkin_id', '=', preCheckinId)
          .execute(),
      ).rejects.toThrow();
    });

    it('accepts a model draft that stays within what the patient said', async () => {
      await answerSome();
      generator.next = () => ({
        narrative: `Patient reports "knee pain for two months". ${NO_DIAGNOSIS_STATEMENT}`,
        sections: [
          {
            key: 'REASON_FOR_VISIT',
            heading: 'Reason for visit',
            statements: [
              {
                text: 'Patient reported: "knee pain for two months"',
                provenance: PROVENANCE_LABELS.PATIENT_REPORTED,
                sourceRef: 'complaintDetail',
              },
            ],
          },
        ],
      });

      const res = await submit().expect(201);
      expect(res.body.generator).toBe('MODEL');
      expect(res.body.fellBackToRules).toBe(false);
    });

    it('refuses a model draft that states a diagnosis, and falls back', async () => {
      await answerSome();
      generator.next = () => ({
        narrative: `Diagnosis: osteoarthritis. ${NO_DIAGNOSIS_STATEMENT}`,
        sections: [],
      });

      const res = await submit().expect(201);

      // The specified behaviour on refusal: the patient is not held up, and the clinician
      // still gets a complete draft — just not that one.
      expect(res.body.generator).toBe('DETERMINISTIC');
      expect(res.body.fellBackToRules).toBe(true);

      const served = await http()
        .get(`/v1/precheckins/${preCheckinId}/draft`)
        .set(headers())
        .expect(200);
      expect(served.body.narrative).not.toContain('osteoarthritis');
    });

    it('keeps the refused draft as evidence of what a generator tried to show', async () => {
      await answerSome();
      generator.next = () => ({ narrative: 'Recommend an X-ray.', sections: [] });
      await submit().expect(201);

      const rejected = await db
        .selectFrom('clinical_summary')
        .selectAll()
        .where('validation_state', '=', 'REJECTED')
        .executeTakeFirstOrThrow();

      expect(rejected.generator).toBe('MODEL');
      expect(JSON.stringify(rejected.rejection_reasons)).toContain('RECOMMENDATION');
      // And the accepted one exists alongside it.
      const accepted = await db
        .selectFrom('clinical_summary')
        .selectAll()
        .where('validation_state', '=', 'ACCEPTED')
        .executeTakeFirstOrThrow();
      expect(accepted.generator).toBe('DETERMINISTIC');
    });

    it('refuses malformed generator output rather than rendering it', async () => {
      await answerSome();
      generator.next = () => ({ narrative: 'text', sections: 'not an array' });

      const res = await submit().expect(201);
      expect(res.body.generator).toBe('DETERMINISTIC');

      const rejected = await db
        .selectFrom('clinical_summary')
        .selectAll()
        .where('validation_state', '=', 'REJECTED')
        .executeTakeFirstOrThrow();
      expect(JSON.stringify(rejected.rejection_reasons)).toContain('SCHEMA_INVALID');
    });

    it('serves the accepted draft, never a refused one', async () => {
      await answerSome();
      generator.next = () => ({ narrative: 'Diagnosis: arthritis.', sections: [] });
      await submit().expect(201);

      const res = await http()
        .get(`/v1/precheckins/${preCheckinId}/draft`)
        .set(headers())
        .expect(200);

      expect(res.body.generator).toBe('DETERMINISTIC');
    });

    it('records that a draft was refused, with codes and no clinical text', async () => {
      await answerSome();
      generator.next = () => ({ narrative: 'Patient likely has arthritis.', sections: [] });
      await submit().expect(201);

      const event = await db
        .selectFrom('audit_event')
        .selectAll()
        .where('action', '=', 'SUMMARY_REFUSED')
        .executeTakeFirstOrThrow();

      const detail = JSON.stringify(event.detail);
      expect(detail).toContain('PROBABILITY_CLAIM');
      // The narrative is in the row, not in the log.
      expect(detail).not.toContain('arthritis');
    });
  });

  describe('an answer must name an option the question offers', () => {
    it('refuses an option id against a question that offers none', async () => {
      // `severity` is a numeric scale with no options. Before this was fixed, an
      // arbitrary identifier was accepted here and reappeared in the clinician's draft as
      // `Patient reported: "moderate"` — a word nobody ever showed the patient.
      await answer({ questionId: 'severity', selectedOptionIds: ['moderate'] }).expect(400);

      const rows = await db.selectFrom('questionnaire_response').selectAll().execute();
      expect(rows).toHaveLength(0);
    });
  });

  describe('a non-committal answer', () => {
    it('reaches the clinician as words, not as an internal identifier', async () => {
      await answer({ questionId: 'chiefComplaint', selectedOptionIds: ['NOT_SURE'] }).expect(201);
      await submit().expect(201);

      const review = await http()
        .get(`/v1/precheckins/${preCheckinId}/review?language=en`)
        .set(headers())
        .expect(200);
      const item = review.body.items.find(
        (i: { questionId: string }) => i.questionId === 'chiefComplaint',
      );
      expect(item.display).toBe('I am not sure');

      const draft = await http()
        .get(`/v1/precheckins/${preCheckinId}/draft`)
        .set(headers())
        .expect(200);

      // `NOT_SURE` is an option id the patient never saw. Non-committal answers are not
      // in `question.options`, so a naive lookup falls through to the raw id and puts an
      // internal identifier in a clinical record.
      expect(JSON.stringify(draft.body)).not.toContain('NOT_SURE');
      expect(JSON.stringify(draft.body)).toContain('I am not sure');
    });
  });

  describe('a numeric answer', () => {
    it('reaches the draft rather than vanishing between the sections', async () => {
      await answerSome();
      // `severity` is a numeric scale. An earlier version only rendered string values, so
      // this answer appeared in neither the sections nor the "not answered" list: the
      // patient answered and the clinician saw nothing.
      await answer({ questionId: 'severity', selectedOptionIds: [], value: 3 }).expect(201);
      await submit().expect(201);

      const res = await http()
        .get(`/v1/precheckins/${preCheckinId}/draft`)
        .set(headers())
        .expect(200);

      const severity = res.body.sections.find((s: { key: string }) => s.key === 'SEVERITY_IMPACT');
      expect(severity).toBeDefined();
      expect(JSON.stringify(severity)).toContain('3');

      const skipped = res.body.sections.find((s: { key: string }) => s.key === 'NOT_ANSWERED');
      expect(JSON.stringify(skipped)).not.toContain('How severe');
    });
  });

  describe('what the draft says about gaps', () => {
    it('reports an unanswered question instead of leaving it silent', async () => {
      await answerSome();
      await submit().expect(201);

      const res = await http()
        .get(`/v1/precheckins/${preCheckinId}/draft`)
        .set(headers())
        .expect(200);

      const skipped = res.body.sections.find((s: { key: string }) => s.key === 'NOT_ANSWERED');
      // A doctor who cannot see that a question was skipped reads it as "no".
      expect(skipped).toBeDefined();
      expect(skipped.statements.length).toBeGreaterThan(0);
    });
  });
});
