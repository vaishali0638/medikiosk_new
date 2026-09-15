import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Kysely } from 'kysely';
import { API_BASE_PATH, CORRELATION_ID_HEADER } from '@medikiosk/api-contracts';
import { SandboxEmrExportAdapter, EmrExportAdapter } from '@medikiosk/his-adapter';
import { NO_DIAGNOSIS_STATEMENT, PROVENANCE_LABELS } from '@medikiosk/terminology';
import type { Database } from '../src/db/database.types';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/domain-exception.filter';
import { createTestDb, seedFixture, truncateAll, type Fixture } from './db-fixture';

const record = {
  narrative: `Patient reports "knee pain". ${NO_DIAGNOSIS_STATEMENT}`,
  sections: [
    {
      key: 'REASON_FOR_VISIT',
      heading: 'Reason for visit',
      statements: [
        {
          text: 'Patient reported: "knee pain"',
          provenance: PROVENANCE_LABELS.PATIENT_REPORTED,
          sourceRef: 'complaintDetail',
        },
      ],
    },
  ],
};

describe('doctor dashboard and HIS export (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let db: Kysely<Database>;
  let fx: Fixture;
  let emr: SandboxEmrExportAdapter;
  let preCheckinId: string;
  let encounterId: string;
  let otherDepartmentId: string;

  const http = () => request(app.getHttpServer());
  const base = (): Record<string, string> => ({ [CORRELATION_ID_HEADER]: randomUUID() });
  const asStaff = (token: string): Record<string, string> => ({
    ...base(),
    authorization: `Bearer ${token}`,
  });

  const addStaff = async (over: {
    subject: string;
    role?: 'CLINICIAN' | 'GOVERNANCE_REVIEWER' | 'OPERATIONS';
    departmentId?: string | null;
    hospitalId?: string;
  }): Promise<string> => {
    await db
      .insertInto('staff_user')
      .values({
        hospital_id: over.hospitalId ?? fx.hospitalId,
        subject: over.subject,
        display_name: over.subject,
        role: over.role ?? 'CLINICIAN',
        department_id: over.departmentId === undefined ? fx.departmentId : over.departmentId,
      })
      .execute();

    const res = await http()
      .post('/v1/doctor/session')
      .set(base())
      .send({ credential: `sandbox:${over.subject}` })
      .expect(201);
    return res.body.token as string;
  };

  beforeAll(async () => {
    // Adapters are selected at import time; see test/setup-integration.ts.
    db = await createTestDb();
    emr = new SandboxEmrExportAdapter();
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmrExportAdapter)
      .useValue(emr)
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
    emr.next = 'ACCEPT';

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
        state: 'ARRIVAL_CONFIRMED',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    preCheckinId = pre.id;

    await db
      .insertInto('clinical_summary')
      .values({
        pre_checkin_id: preCheckinId,
        generator: 'DETERMINISTIC',
        generator_version: '1.0.0',
        content: JSON.stringify(record),
        validation_state: 'ACCEPTED',
        rejection_reasons: JSON.stringify([]),
        provenance_label: PROVENANCE_LABELS.AI_ASSISTED_DRAFT,
        correlation_id: randomUUID(),
      })
      .execute();

    const encounter = await db
      .insertInto('encounter')
      .values({
        patient_id: fx.patientId,
        department_id: fx.departmentId,
        pre_checkin_id: preCheckinId,
        visit_type: 'NEW_COMPLAINT',
        his_token: 'AYU-0001',
        token_issued_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    encounterId = encounter.id;

    const other = await db
      .insertInto('department')
      .values({
        branch_id: fx.branchId,
        code: 'UNA-2',
        name: 'Unani OPD 2',
        ayush_system: 'UNANI',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    otherDepartmentId = other.id;
  });

  describe('signing in', () => {
    it('issues a session for a provisioned clinician', async () => {
      const token = await addStaff({ subject: 'dr.sharma' });
      expect(token).toHaveLength(43);
    });

    it('refuses a subject with no staff record, identically to a bad credential', async () => {
      const unknown = await http()
        .post('/v1/doctor/session')
        .set(base())
        .send({ credential: 'sandbox:not.staff' })
        .expect(401);

      const bad = await http()
        .post('/v1/doctor/session')
        .set(base())
        .send({ credential: 'garbage' })
        .expect(401);

      // Distinguishing them would tell an outsider who works at this hospital.
      expect(unknown.body.code).toBe(bad.body.code);
    });

    it('refuses a disabled account', async () => {
      await addStaff({ subject: 'dr.left' });
      await db.updateTable('staff_user').set({ enabled: false }).execute();

      await http()
        .post('/v1/doctor/session')
        .set(base())
        .send({ credential: 'sandbox:dr.left' })
        .expect(401);
    });

    it('refuses every clinical endpoint without a session', async () => {
      await http().get('/v1/doctor/worklist').set(base()).expect(401);
      await http().get(`/v1/doctor/encounters/${encounterId}`).set(base()).expect(401);
      await http().post(`/v1/doctor/encounters/${encounterId}/export`).set(base()).expect(401);
    });

    it('stops working after sign-out', async () => {
      const token = await addStaff({ subject: 'dr.sharma' });
      await http().post('/v1/doctor/session/end').set(asStaff(token)).expect(201);
      await http().get('/v1/doctor/worklist').set(asStaff(token)).expect(401);
    });
  });

  describe('who may read a record', () => {
    it('shows the clinician their own department’s patients', async () => {
      const token = await addStaff({ subject: 'dr.sharma' });
      const res = await http().get('/v1/doctor/worklist').set(asStaff(token)).expect(200);

      expect(res.body.entries).toHaveLength(1);
      expect(res.body.entries[0].token).toBe('AYU-0001');
      // The worklist is often on a second monitor in a shared room.
      expect(res.body.entries[0].maskedName).toBe('R*** K****');
    });

    it('does not show another department’s patients', async () => {
      const token = await addStaff({ subject: 'dr.other', departmentId: otherDepartmentId });
      const res = await http().get('/v1/doctor/worklist').set(asStaff(token)).expect(200);

      expect(res.body.entries).toHaveLength(0);
    });

    it('refuses a record from another department without a reason', async () => {
      const token = await addStaff({ subject: 'dr.other', departmentId: otherDepartmentId });
      await http().get(`/v1/doctor/encounters/${encounterId}`).set(asStaff(token)).expect(403);
    });

    it('allows break-glass with a reason, and records it where a human will see it', async () => {
      const token = await addStaff({ subject: 'dr.other', departmentId: otherDepartmentId });
      await http()
        .get(`/v1/doctor/encounters/${encounterId}`)
        .query({ breakGlassReason: 'covering the Ayurveda clinic this evening' })
        .set(asStaff(token))
        .expect(200);

      const row = await db.selectFrom('break_glass_access').selectAll().executeTakeFirstOrThrow();
      expect(row.reason).toContain('covering the Ayurveda clinic');
    });

    it('refuses a non-clinical role outright', async () => {
      const token = await addStaff({ subject: 'ops.person', role: 'OPERATIONS' });
      await http().get('/v1/doctor/worklist').set(asStaff(token)).expect(403);
      await http().get(`/v1/doctor/encounters/${encounterId}`).set(asStaff(token)).expect(403);
    });

    it('refuses a record at another hospital exactly as it refuses an unknown one', async () => {
      const otherHospital = await db
        .insertInto('hospital')
        .values({ code: 'HOSP-OTHER', name: 'Another hospital' })
        .returningAll()
        .executeTakeFirstOrThrow();
      const token = await addStaff({
        subject: 'dr.elsewhere',
        hospitalId: otherHospital.id,
        departmentId: null,
      });

      const foreign = await http()
        .get(`/v1/doctor/encounters/${encounterId}`)
        .set(asStaff(token))
        .expect(403);
      const missing = await http()
        .get(`/v1/doctor/encounters/${randomUUID()}`)
        .set(asStaff(token))
        .expect(403);

      // A clinician trying ids must not learn which exist.
      expect(foreign.body.code).toBe(missing.body.code);
      expect(foreign.body.patientMessage).toBe(missing.body.patientMessage);
    });

    it('audits every view of a clinical record', async () => {
      const token = await addStaff({ subject: 'dr.sharma' });
      await http().get(`/v1/doctor/encounters/${encounterId}`).set(asStaff(token)).expect(200);

      const event = await db
        .selectFrom('audit_event')
        .selectAll()
        .where('action', '=', 'CLINICAL_RECORD_VIEWED')
        .executeTakeFirstOrThrow();
      expect(event.entity_id).toBe(encounterId);
    });
  });

  describe('the case a clinician reads', () => {
    it('carries the draft with its unverified banner', async () => {
      const token = await addStaff({ subject: 'dr.sharma' });
      const res = await http()
        .get(`/v1/doctor/encounters/${encounterId}`)
        .set(asStaff(token))
        .expect(200);

      expect(res.body.draft.provenance).toBe(PROVENANCE_LABELS.AI_ASSISTED_DRAFT);
      // Names what produced it. No model ships, so every draft here is composed by rule,
      // and telling a clinician "AI-assisted" over their patient's own quoted answers
      // invites distrust of the most reliable material in the record.
      expect(res.body.draft.generator).toBe('DETERMINISTIC');
      expect(res.body.draft.banner).toBe(
        "Pre-consultation draft from the patient's own answers — not verified",
      );
      expect(res.body.verified).toBe(false);
    });
  });

  describe('documents in the case view', () => {
    const addDocument = async (state: 'STORED' | 'REJECTED_INVALID'): Promise<string> => {
      const row = await db
        .insertInto('document')
        .values({
          pre_checkin_id: preCheckinId,
          patient_id: fx.patientId,
          document_type: 'PRESCRIPTION',
          object_key: `k/${randomUUID()}`,
          content_type: 'image/jpeg',
          byte_size: '26',
          sha256: 'a'.repeat(64),
          state,
          encryption_key_id: state === 'STORED' ? 'test-key' : null,
          // `document_stored_is_scanned` will not accept a stored document that no
          // scanner ever looked at.
          malware_scanned_at: state === 'STORED' ? new Date() : null,
          rejection_reason: state === 'STORED' ? null : 'NO_SCANNER_CONFIGURED',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return row.id;
    };

    it('offers a signed link for a stored document', async () => {
      await addDocument('STORED');
      const token = await addStaff({ subject: 'dr.sharma' });

      const res = await http()
        .get(`/v1/doctor/encounters/${encounterId}`)
        .set(asStaff(token))
        .expect(200);

      expect(res.body.documents[0].link.url).toContain('sig=');
    });

    it('lists a refused document but offers no link to bytes that do not exist', async () => {
      await addDocument('REJECTED_INVALID');
      const token = await addStaff({ subject: 'dr.sharma' });

      const res = await http()
        .get(`/v1/doctor/encounters/${encounterId}`)
        .set(asStaff(token))
        .expect(200);

      // The clinician should know the patient tried to supply something; a link that
      // always fails is worse than none, and it fails on the document they most want.
      expect(res.body.documents[0].state).toBe('REJECTED_INVALID');
      expect(res.body.documents[0].link).toBeNull();
    });
  });

  describe('confirmation', () => {
    it('writes a verified record without destroying the draft', async () => {
      const token = await addStaff({ subject: 'dr.sharma' });
      await http()
        .post(`/v1/doctor/encounters/${encounterId}/confirm`)
        .set(asStaff(token))
        .send({ record })
        .expect(201);

      const summaries = await db.selectFrom('clinical_summary').selectAll().execute();
      // Two rows: what the generator produced, and what the clinician signed. Overwriting
      // the first would destroy the evidence of what they were shown.
      expect(summaries).toHaveLength(2);
      expect(
        summaries.filter((s) => s.provenance_label === PROVENANCE_LABELS.CLINICIAN_VERIFIED),
      ).toHaveLength(1);
    });

    it('marks the encounter verified, which is what a follow-up reads', async () => {
      const token = await addStaff({ subject: 'dr.sharma' });
      await http()
        .post(`/v1/doctor/encounters/${encounterId}/confirm`)
        .set(asStaff(token))
        .send({ record })
        .expect(201);

      const encounter = await db
        .selectFrom('encounter')
        .selectAll()
        .where('id', '=', encounterId)
        .executeTakeFirstOrThrow();
      expect(encounter.verified_at).not.toBeNull();
      expect(encounter.verified_by_user_id).not.toBeNull();
      expect(encounter.verified_summary_id).not.toBeNull();
    });

    it('is idempotent: a second confirmation does not replace the first signature', async () => {
      const first = await addStaff({ subject: 'dr.sharma' });
      const a = await http()
        .post(`/v1/doctor/encounters/${encounterId}/confirm`)
        .set(asStaff(first))
        .send({ record })
        .expect(201);
      const b = await http()
        .post(`/v1/doctor/encounters/${encounterId}/confirm`)
        .set(asStaff(first))
        .send({ record })
        .expect(201);

      expect(b.body.summaryId).toBe(a.body.summaryId);
    });

    it('refuses a malformed record rather than signing it', async () => {
      const token = await addStaff({ subject: 'dr.sharma' });
      await http()
        .post(`/v1/doctor/encounters/${encounterId}/confirm`)
        .set(asStaff(token))
        .send({ record: { sections: 'not an array' } })
        .expect(400);

      const encounter = await db
        .selectFrom('encounter')
        .selectAll()
        .where('id', '=', encounterId)
        .executeTakeFirstOrThrow();
      expect(encounter.verified_at).toBeNull();
    });
  });

  describe('export', () => {
    const confirm = async (token: string): Promise<void> => {
      await http()
        .post(`/v1/doctor/encounters/${encounterId}/confirm`)
        .set(asStaff(token))
        .send({ record })
        .expect(201);
    };

    it('refuses to export a record no clinician has confirmed', async () => {
      const token = await addStaff({ subject: 'dr.sharma' });
      await http()
        .post(`/v1/doctor/encounters/${encounterId}/export`)
        .set(asStaff(token))
        .expect(400);

      expect(await db.selectFrom('encounter_export').selectAll().execute()).toHaveLength(0);
    });

    it('exports a confirmed record', async () => {
      const token = await addStaff({ subject: 'dr.sharma' });
      await confirm(token);

      const res = await http()
        .post(`/v1/doctor/encounters/${encounterId}/export`)
        .set(asStaff(token))
        .expect(201);

      expect(res.body.state).toBe('ACKNOWLEDGED');
      expect(res.body.hisRecordRef).toMatch(/^EMR-/);
    });

    it('is idempotent: exporting twice does not duplicate the note', async () => {
      const token = await addStaff({ subject: 'dr.sharma' });
      await confirm(token);

      const a = await http()
        .post(`/v1/doctor/encounters/${encounterId}/export`)
        .set(asStaff(token))
        .expect(201);
      const b = await http()
        .post(`/v1/doctor/encounters/${encounterId}/export`)
        .set(asStaff(token))
        .expect(201);

      expect(b.body.hisRecordRef).toBe(a.body.hisRecordRef);
      expect(await db.selectFrom('encounter_export').selectAll().execute()).toHaveLength(1);
    });

    it('reconciles an uncertain outcome instead of retrying blindly', async () => {
      const token = await addStaff({ subject: 'dr.sharma' });
      await confirm(token);
      emr.next = 'UNCERTAIN';

      const res = await http()
        .post(`/v1/doctor/encounters/${encounterId}/export`)
        .set(asStaff(token))
        .expect(201);

      // The sandbox recorded it despite answering uncertain, exactly as a real HIS that
      // timed out after committing would. Asking finds it; guessing would duplicate it.
      expect(res.body.state).toBe('ACKNOWLEDGED');
    });

    it('records a rejection without claiming the record was filed', async () => {
      const token = await addStaff({ subject: 'dr.sharma' });
      await confirm(token);
      emr.next = 'REJECT';

      const res = await http()
        .post(`/v1/doctor/encounters/${encounterId}/export`)
        .set(asStaff(token))
        .expect(201);

      expect(res.body.state).toBe('FAILED');
      expect(res.body.hisRecordRef).toBeNull();
    });

    it('logs the export', async () => {
      const token = await addStaff({ subject: 'dr.sharma' });
      await confirm(token);
      await http()
        .post(`/v1/doctor/encounters/${encounterId}/export`)
        .set(asStaff(token))
        .expect(201);

      const event = await db
        .selectFrom('audit_event')
        .selectAll()
        .where('action', '=', 'CLINICAL_RECORD_EXPORTED')
        .executeTakeFirstOrThrow();
      expect(event.entity_id).toBe(encounterId);
    });
  });
});
