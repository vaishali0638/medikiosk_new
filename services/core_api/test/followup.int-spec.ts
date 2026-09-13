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
import { NO_DIAGNOSIS_STATEMENT, PROVENANCE_LABELS } from '@medikiosk/terminology';
import type { Database } from '../src/db/database.types';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/domain-exception.filter';
import { createTestDb, seedFixture, truncateAll, type Fixture } from './db-fixture';

/** A record shaped like one a clinician confirmed at a previous visit. */
const verifiedRecord = {
  narrative: `Patient reports "knee pain". ${NO_DIAGNOSIS_STATEMENT}`,
  sections: [
    {
      key: 'CURRENT_MEDICINES',
      heading: 'Current medicines',
      statements: [
        {
          text: 'Metformin 500 mg twice a day',
          provenance: PROVENANCE_LABELS.PATIENT_REPORTED,
          sourceRef: 'currentMedicines',
        },
      ],
    },
    {
      key: 'PAST_HISTORY',
      heading: 'Past history',
      statements: [
        {
          text: 'Hypertension',
          provenance: PROVENANCE_LABELS.PATIENT_REPORTED,
          sourceRef: 'chronicConditions',
        },
      ],
    },
  ],
};

describe('follow-up delta (integration)', () => {
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

  /** A previous visit, verified by a named clinician. */
  const seedVerifiedVisit = async (
    over: { label?: string; verify?: boolean } = {},
  ): Promise<{ encounterId: string; summaryId: string; previousPreCheckinId: string }> => {
    const previous = await db
      .insertInto('pre_checkin')
      .values({
        patient_id: fx.patientId,
        consent_id: consentId,
        hospital_id: fx.hospitalId,
        branch_id: fx.branchId,
        department_id: fx.departmentId,
        visit_type: 'NEW_COMPLAINT',
        visit_window_start: new Date(Date.now() - 86_400_000 * 30),
        visit_window_end: new Date(Date.now() - 86_400_000 * 29),
        state: 'DRAFT',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const verify = over.verify ?? true;
    const summary = await db
      .insertInto('clinical_summary')
      .values({
        pre_checkin_id: previous.id,
        generator: 'DETERMINISTIC',
        generator_version: '1.0.0',
        content: JSON.stringify(verifiedRecord),
        validation_state: 'ACCEPTED',
        rejection_reasons: JSON.stringify([]),
        provenance_label: over.label ?? PROVENANCE_LABELS.CLINICIAN_VERIFIED,
        verified_by_user_id: verify ? 'dr.sharma' : null,
        verified_at: verify ? new Date(Date.now() - 86_400_000 * 29) : null,
        correlation_id: randomUUID(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const encounter = await db
      .insertInto('encounter')
      .values({
        patient_id: fx.patientId,
        department_id: fx.departmentId,
        pre_checkin_id: previous.id,
        visit_type: 'NEW_COMPLAINT',
        his_token: 'AYU-0001',
        token_issued_at: new Date(Date.now() - 86_400_000 * 30),
        verified_at: verify ? new Date(Date.now() - 86_400_000 * 29) : null,
        verified_by_user_id: verify ? 'dr.sharma' : null,
        verified_summary_id: verify ? summary.id : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return {
      encounterId: encounter.id,
      summaryId: summary.id,
      previousPreCheckinId: previous.id,
    };
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
        visit_type: 'REGULAR_FOLLOW_UP',
        visit_window_start: new Date(Date.now() - 3_600_000),
        visit_window_end: new Date(Date.now() + 3_600_000),
        state: 'DRAFT',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    preCheckinId = pre.id;
  });

  describe('the baseline is a verified visit, never a draft', () => {
    it('finds the last visit a clinician signed off', async () => {
      await seedVerifiedVisit();

      const res = await http()
        .get(`/v1/precheckins/${preCheckinId}/previous-visit`)
        .set(headers())
        .expect(200);

      expect(res.body.hasPreviousVerifiedVisit).toBe(true);
      expect(res.body.provenance).toBe(PROVENANCE_LABELS.CLINICIAN_VERIFIED);
      // The doctor can inspect the record itself, not a summary of a summary.
      expect(JSON.stringify(res.body.record)).toContain('Hypertension');
    });

    it('ignores an unverified AI draft entirely', async () => {
      // The exit criterion, stated as a test. An encounter exists and a summary exists,
      // but no clinician signed either, so there is no baseline.
      await seedVerifiedVisit({ label: PROVENANCE_LABELS.AI_ASSISTED_DRAFT, verify: false });

      const res = await http()
        .get(`/v1/precheckins/${preCheckinId}/previous-visit`)
        .set(headers())
        .expect(200);

      expect(res.body.hasPreviousVerifiedVisit).toBe(false);
      expect(res.body.record).toBeUndefined();
    });

    it('cannot mark an encounter verified without naming a clinician', async () => {
      const { summaryId } = await seedVerifiedVisit();

      // The database refuses a half-verification. A signature with no name is not one,
      // and a name with no time cannot be ordered against the next.
      await expect(
        db
          .insertInto('encounter')
          .values({
            patient_id: fx.patientId,
            department_id: fx.departmentId,
            visit_type: 'NEW_COMPLAINT',
            verified_at: new Date(),
            verified_summary_id: summaryId,
          })
          .execute(),
      ).rejects.toThrow();
    });

    it('refuses a malformed id cleanly instead of failing inside the database', async () => {
      // A junk id used to reach Postgres and come back as a 500 with a stack in the log.
      // Three things were wrong with that: a malformed request is the client's fault; a
      // 500 on every junk id makes scanner traffic indistinguishable from a real fault;
      // and 500-for-junk against 400-for-unknown told an unauthenticated caller which
      // ids were well-formed.
      const res = await http()
        .get('/v1/precheckins/not-a-uuid/previous-visit')
        .set(headers())
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('answers a well-formed but unknown id exactly the same way', async () => {
      const res = await http()
        .get(`/v1/precheckins/${randomUUID()}/previous-visit`)
        .set(headers())
        .expect(400);

      // Indistinguishable from the malformed case, so neither confirms anything.
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('reports no previous visit for a first-time patient', async () => {
      const res = await http()
        .get(`/v1/precheckins/${preCheckinId}/previous-visit`)
        .set(headers())
        .expect(200);

      expect(res.body.hasPreviousVerifiedVisit).toBe(false);
    });
  });

  describe('recording what changed', () => {
    it('refuses when there is nothing verified to measure against', async () => {
      await http()
        .post(`/v1/precheckins/${preCheckinId}/follow-up`)
        .set(headers())
        .send({ changes: [{ section: 'MEDICINES', detail: 'stopped it' }] })
        .expect(400);
    });

    it('keeps unchanged, changed and not-confirmed apart', async () => {
      await seedVerifiedVisit();

      await http()
        .post(`/v1/precheckins/${preCheckinId}/follow-up`)
        .set(headers())
        .send({
          changes: [
            { section: 'MEDICINES', detail: 'stopped the metformin last month' },
            { section: 'NEW_SYMPTOM', detail: 'dizziness for three days' },
          ],
        })
        .expect(201);

      const res = await http()
        .get(`/v1/precheckins/${preCheckinId}/delta`)
        .set(headers())
        .expect(200);

      // Hypertension came from a record the clinician signed and the patient did not
      // contradict it.
      expect(res.body.unchanged.map((i: { label: string }) => i.label)).toContain('Hypertension');
      // The medicine was contradicted, so it moves rather than staying put.
      expect(res.body.changed.map((i: { label: string }) => i.label)).toContain(
        'Metformin 500 mg twice a day',
      );
      // And a new symptom has no baseline to be changed from.
      expect(res.body.changed.map((i: { kind: string }) => i.kind)).toContain('NEW_SYMPTOM');
    });

    it('carries a verified item forward with its own provenance', async () => {
      await seedVerifiedVisit();
      await http()
        .post(`/v1/precheckins/${preCheckinId}/follow-up`)
        .set(headers())
        .send({ changes: [] })
        .expect(201);

      const res = await http()
        .get(`/v1/precheckins/${preCheckinId}/delta`)
        .set(headers())
        .expect(200);

      const unchanged = res.body.unchanged[0];
      // Not relabelled as something the patient said today. It is what a clinician
      // confirmed, and it keeps saying so.
      expect(unchanged.source).toBe('CLINICIAN_VERIFIED');
    });

    it('lists an unchanged item rather than omitting it', async () => {
      await seedVerifiedVisit();
      await http()
        .post(`/v1/precheckins/${preCheckinId}/follow-up`)
        .set(headers())
        .send({ changes: [] })
        .expect(201);

      const res = await http()
        .get(`/v1/precheckins/${preCheckinId}/delta`)
        .set(headers())
        .expect(200);

      // "The hypertension is stable" and "nobody asked about the hypertension" call for
      // different consultations, and a delta of changes alone cannot tell them apart.
      expect(res.body.unchanged.length).toBeGreaterThan(0);
      expect(res.body.changed).toHaveLength(0);
    });

    it('keeps two items apart when they render as the same sentence', async () => {
      // A patient who answers several questions "I am not sure" produces byte-identical
      // statements under one section. An earlier version keyed item identity on the
      // rendered text and this was a 500 the first time it met a real record.
      await seedVerifiedVisit();
      const summary = await db
        .selectFrom('clinical_summary')
        .select('id')
        .executeTakeFirstOrThrow();
      await db
        .updateTable('clinical_summary')
        .set({
          content: JSON.stringify({
            narrative: verifiedRecord.narrative,
            sections: [
              {
                key: 'PAST_HISTORY',
                heading: 'Past history',
                statements: [
                  {
                    text: 'Patient reported: "I am not sure"',
                    provenance: PROVENANCE_LABELS.PATIENT_REPORTED,
                    sourceRef: 'smoking',
                  },
                  {
                    text: 'Patient reported: "I am not sure"',
                    provenance: PROVENANCE_LABELS.PATIENT_REPORTED,
                    sourceRef: 'alcohol',
                  },
                ],
              },
            ],
          }),
        })
        .where('id', '=', summary.id)
        .execute();

      await http()
        .post(`/v1/precheckins/${preCheckinId}/follow-up`)
        .set(headers())
        .send({ changes: [] })
        .expect(201);

      const res = await http()
        .get(`/v1/precheckins/${preCheckinId}/delta`)
        .set(headers())
        .expect(200);

      expect(res.body.unchanged).toHaveLength(2);
    });

    it('replaces a previous delta so a patient may correct themselves', async () => {
      await seedVerifiedVisit();

      await http()
        .post(`/v1/precheckins/${preCheckinId}/follow-up`)
        .set(headers())
        .send({ changes: [{ section: 'MEDICINES' }] })
        .expect(201);
      await http()
        .post(`/v1/precheckins/${preCheckinId}/follow-up`)
        .set(headers())
        .send({ changes: [] })
        .expect(201);

      const res = await http()
        .get(`/v1/precheckins/${preCheckinId}/delta`)
        .set(headers())
        .expect(200);

      expect(res.body.changed).toHaveLength(0);
      const rows = await db
        .selectFrom('follow_up_delta')
        .selectAll()
        .where('pre_checkin_id', '=', preCheckinId)
        .execute();
      expect(rows.filter((r) => r.change_kind === 'CHANGED')).toHaveLength(0);
    });

    it('records counts in the audit trail and no clinical text', async () => {
      await seedVerifiedVisit();
      await http()
        .post(`/v1/precheckins/${preCheckinId}/follow-up`)
        .set(headers())
        .send({ changes: [{ section: 'MEDICINES', detail: 'stopped the metformin' }] })
        .expect(201);

      const event = await db
        .selectFrom('audit_event')
        .selectAll()
        .where('action', '=', 'FOLLOW_UP_DELTA_RECORDED')
        .executeTakeFirstOrThrow();

      const detail = JSON.stringify(event.detail);
      expect(detail).toContain('unchanged');
      expect(detail).not.toContain('metformin');
      expect(detail).not.toContain('Metformin');
    });
  });

  describe('what nobody has established', () => {
    it('surfaces a non-committal answer as not confirmed', async () => {
      await seedVerifiedVisit();
      await db
        .insertInto('questionnaire_response')
        .values({
          pre_checkin_id: preCheckinId,
          questionnaire_key: 'common-core',
          questionnaire_ver: '0.1.0-placeholder',
          question_id: 'hasAllergy',
          answer: JSON.stringify({ value: null, selectedOptionIds: ['NOT_SURE'] }),
          source: 'PATIENT_SELECTED',
          modality: 'TOUCH',
          language_tag: 'en',
          revision: 1,
        })
        .execute();

      await http()
        .post(`/v1/precheckins/${preCheckinId}/follow-up`)
        .set(headers())
        .send({ changes: [] })
        .expect(201);

      const res = await http()
        .get(`/v1/precheckins/${preCheckinId}/delta`)
        .set(headers())
        .expect(200);

      expect(res.body.notConfirmed.map((i: { label: string }) => i.label)).toContain('hasAllergy');
    });

    it('does not resurrect an uncertainty the patient later resolved', async () => {
      await seedVerifiedVisit();
      for (const [revision, option] of [
        [1, 'NOT_SURE'],
        [2, 'no'],
      ] as const) {
        await db
          .insertInto('questionnaire_response')
          .values({
            pre_checkin_id: preCheckinId,
            questionnaire_key: 'common-core',
            questionnaire_ver: '0.1.0-placeholder',
            question_id: 'hasAllergy',
            answer: JSON.stringify({ value: null, selectedOptionIds: [option] }),
            source: 'PATIENT_SELECTED',
            modality: 'TOUCH',
            language_tag: 'en',
            revision,
          })
          .execute();
      }

      await http()
        .post(`/v1/precheckins/${preCheckinId}/follow-up`)
        .set(headers())
        .send({ changes: [] })
        .expect(201);

      const res = await http()
        .get(`/v1/precheckins/${preCheckinId}/delta`)
        .set(headers())
        .expect(200);

      // The patient corrected themselves on the review screen. Putting the superseded
      // answer in front of the doctor would be a resolved uncertainty presented as open.
      expect(res.body.notConfirmed.map((i: { label: string }) => i.label)).not.toContain(
        'hasAllergy',
      );
    });
  });
});
