import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Kysely } from 'kysely';
import { API_BASE_PATH, CORRELATION_ID_HEADER } from '@medikiosk/api-contracts';
import type { Database } from '../src/db/database.types';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/domain-exception.filter';
import { QuestionnaireService } from '../src/intake/questionnaire.service';
import { createTestDb, seedFixture, truncateAll, type Fixture } from './db-fixture';

const QUESTIONNAIRE = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../infra/seed-content/questionnaire.common-core.en.json'),
    'utf8',
  ),
) as Record<string, unknown>;

const now = (): string => new Date().toISOString();

describe('clinical governance console (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let db: Kysely<Database>;
  let fx: Fixture;
  let reviewerToken: string;

  const http = () => request(app.getHttpServer());
  const base = (): Record<string, string> => ({ [CORRELATION_ID_HEADER]: randomUUID() });
  const as = (token: string): Record<string, string> => ({
    ...base(),
    authorization: `Bearer ${token}`,
  });

  const addStaff = async (
    subject: string,
    role: 'CLINICIAN' | 'GOVERNANCE_REVIEWER' | 'OPERATIONS',
  ): Promise<string> => {
    await db
      .insertInto('staff_user')
      .values({
        hospital_id: fx.hospitalId,
        subject,
        display_name: subject,
        role,
        department_id: role === 'CLINICIAN' ? fx.departmentId : null,
      })
      .execute();

    const res = await http()
      .post('/v1/doctor/session')
      .set(base())
      .send({ credential: `sandbox:${subject}` })
      .expect(201);
    return res.body.token as string;
  };

  const draft = async (over: Record<string, unknown> = {}): Promise<string> => {
    const res = await http()
      .post('/v1/governance/releases')
      .set(as(reviewerToken))
      .send({
        contentKind: 'QUESTIONNAIRE',
        contentKey: 'common-core/en',
        semver: '1.0.0',
        payload: QUESTIONNAIRE,
        ...over,
      })
      .expect(201);
    return res.body.releaseId as string;
  };

  const approve = (id: string, body: Record<string, unknown>) =>
    http().post(`/v1/governance/releases/${id}/approvals`).set(as(reviewerToken)).send(body);

  const move = (id: string, body: Record<string, unknown>) =>
    http().post(`/v1/governance/releases/${id}/transition`).set(as(reviewerToken)).send(body);

  /** Takes a questionnaire draft all the way to APPROVED. */
  const approveFully = async (id: string): Promise<void> => {
    await move(id, { to: 'IN_REVIEW' }).expect(201);
    await approve(id, { role: 'AUTHOR', by: 'Dr Rao', at: now() }).expect(201);
    await approve(id, {
      role: 'CLINICAL_REVIEWER',
      by: 'Dr Sharma',
      qualification: 'BAMS, MD (Ayurveda)',
      at: now(),
    }).expect(201);
    await move(id, { to: 'APPROVED' }).expect(201);
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
    await db.deleteFrom('governance_version').execute();
    reviewerToken = await addStaff('gov.reviewer', 'GOVERNANCE_REVIEWER');
  });

  describe('who may release content', () => {
    it('refuses a clinician', async () => {
      const token = await addStaff('dr.sharma', 'CLINICIAN');
      await http()
        .post('/v1/governance/releases')
        .set(as(token))
        .send({ contentKind: 'QUESTIONNAIRE', contentKey: 'k/en', semver: '1.0.0', payload: {} })
        .expect(403);
    });

    it('refuses an unauthenticated caller', async () => {
      await http().get('/v1/governance/releases').set(base()).expect(401);
    });
  });

  describe('authoring', () => {
    it('validates content at authoring, not three reviews later', async () => {
      await http()
        .post('/v1/governance/releases')
        .set(as(reviewerToken))
        .send({
          contentKind: 'QUESTIONNAIRE',
          contentKey: 'broken/en',
          semver: '1.0.0',
          payload: { key: 'broken', version: '1.0.0', title: 'x', nodes: 'not an array' },
        })
        .expect(400);
    });

    it('refuses a questionnaire that branches on a question asked later', async () => {
      // Content that looks complete to a reviewer and asks the patient nothing: the
      // condition can never be true, so the question it guards is unreachable.
      await http()
        .post('/v1/governance/releases')
        .set(as(reviewerToken))
        .send({
          contentKind: 'QUESTIONNAIRE',
          contentKey: 'ordering/en',
          semver: '1.0.0',
          payload: {
            key: 'ordering',
            version: '1.0.0',
            title: 'Ordering',
            nodes: [
              {
                question: {
                  id: 'first',
                  type: 'TEXT',
                  section: 'OTHER',
                  prompt: 'First?',
                  nonCommittal: ['NOT_SURE'],
                },
                askWhen: { kind: 'ANSWERED', questionId: 'second' },
              },
              {
                question: {
                  id: 'second',
                  type: 'TEXT',
                  section: 'OTHER',
                  prompt: 'Second?',
                  nonCommittal: ['NOT_SURE'],
                },
              },
            ],
          },
        })
        .expect(400);
    });

    it('refuses a duplicate version number', async () => {
      await draft();
      await http()
        .post('/v1/governance/releases')
        .set(as(reviewerToken))
        .send({
          contentKind: 'QUESTIONNAIRE',
          contentKey: 'common-core/en',
          semver: '1.0.0',
          payload: QUESTIONNAIRE,
        })
        .expect(400);
    });
  });

  describe('no high-risk change has single-person approval', () => {
    it('refuses to approve a questionnaire with no approvals at all', async () => {
      const id = await draft();
      await move(id, { to: 'IN_REVIEW' }).expect(201);
      await move(id, { to: 'APPROVED' }).expect(400);
    });

    it('refuses when one person fills every role', async () => {
      const id = await draft();
      await move(id, { to: 'IN_REVIEW' }).expect(201);
      await approve(id, { role: 'AUTHOR', by: 'Dr Rao', at: now() }).expect(201);
      await approve(id, {
        role: 'CLINICAL_REVIEWER',
        by: 'Dr Rao',
        qualification: 'BAMS',
        at: now(),
      }).expect(201);

      // One person holding both roles is not two checks.
      const res = await move(id, { to: 'APPROVED' }).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('tells the reviewer what is missing, unlike every patient-facing refusal', async () => {
      const id = await draft();
      await move(id, { to: 'IN_REVIEW' }).expect(201);
      await approve(id, { role: 'AUTHOR', by: 'Dr Rao', at: now() }).expect(201);
      await approve(id, {
        role: 'CLINICAL_REVIEWER',
        by: 'Dr Rao',
        qualification: 'BAMS',
        at: now(),
      }).expect(201);

      const res = await move(id, { to: 'APPROVED' }).expect(400);

      // A kiosk gets one neutral sentence, because it stands in a public corridor and an
      // error that explains itself is an oracle. A governance reviewer is authenticated,
      // role-checked, and is the person who has to fix it — and the gate returns every
      // problem at once precisely so they can be fixed in one pass. Withholding this left
      // the console refusing releases with no way to tell why.
      expect(res.body.detail).toContain('needs 2 distinct approvers');
      expect(res.body.patientMessage).toBeDefined();
    });

    it('accepts two distinct named approvers with a stated qualification', async () => {
      const id = await draft();
      await approveFully(id);

      const row = await db
        .selectFrom('governance_version')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row.state).toBe('APPROVED');
    });
  });

  describe('nothing unreviewed reaches a patient', () => {
    it('cannot publish straight from draft', async () => {
      const id = await draft();
      // 409 from the state machine: there is no such edge, at all.
      await move(id, { to: 'PUBLISHED' }).expect(409);
    });

    it('cannot canary straight from draft either', async () => {
      const id = await draft();
      await move(id, { to: 'CANARY', canaryKioskCodes: ['MK-OPD-01'] }).expect(409);
    });

    it('publishes once approved, naming who did it', async () => {
      const id = await draft();
      await approveFully(id);
      await move(id, { to: 'PUBLISHED' }).expect(201);

      const row = await db
        .selectFrom('governance_version')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row.state).toBe('PUBLISHED');
      expect(row.published_by_user_id).not.toBeNull();
      expect(row.published_at).not.toBeNull();
    });

    it('the database refuses live content with no named publisher', async () => {
      await expect(
        db
          .insertInto('governance_version')
          .values({
            hospital_id: fx.hospitalId,
            content_kind: 'QUESTIONNAIRE',
            content_key: 'sneaky/en',
            semver: '9.9.9',
            state: 'PUBLISHED',
            payload: JSON.stringify(QUESTIONNAIRE),
            author_actor_id: 'nobody',
            approvals: JSON.stringify([]),
          })
          .execute(),
      ).rejects.toThrow();
    });
  });

  describe('canary', () => {
    it('must name the kiosks it reaches', async () => {
      const id = await draft();
      await approveFully(id);
      await move(id, { to: 'CANARY', canaryKioskCodes: [] }).expect(400);
    });

    it('reaches the named kiosk and no other', async () => {
      // A published baseline for every kiosk.
      const baseline = await draft({ semver: '1.0.0' });
      await approveFully(baseline);
      await move(baseline, { to: 'PUBLISHED' }).expect(201);

      // A canary, on one kiosk only.
      const canary = await draft({ semver: '1.1.0' });
      await approveFully(canary);
      await move(canary, { to: 'CANARY', canaryKioskCodes: ['MK-OPD-01'] }).expect(201);

      // Resolution is the property, so it is tested where it happens rather than through
      // an endpoint that would also be exercising consent and device guards.
      const questionnaires = moduleRef.get(QuestionnaireService);
      const onCanaryKiosk = await questionnaires.findPublished(
        fx.hospitalId,
        'common-core',
        'en',
        'MK-OPD-01',
      );
      const onEveryOtherKiosk = await questionnaires.findPublished(
        fx.hospitalId,
        'common-core',
        'en',
        'MK-OPD-99',
      );
      const withNoKiosk = await questionnaires.findPublished(fx.hospitalId, 'common-core', 'en');

      expect(onCanaryKiosk?.version).toBe('1.1.0');
      // Every other kiosk carries on with the published version, which is the whole point.
      expect(onEveryOtherKiosk?.version).toBe('1.0.0');
      // And a caller with no kiosk at all — the patient's own phone — is never in a canary.
      expect(withNoKiosk?.version).toBe('1.0.0');

      const rows = await db
        .selectFrom('governance_version')
        .select(['semver', 'state', 'canary_kiosk_codes'])
        .where('content_key', '=', 'common-core/en')
        .execute();

      // Both live at once. That is the point of a canary: it runs alongside.
      expect(rows.find((r) => r.semver === '1.0.0')?.state).toBe('PUBLISHED');
      expect(rows.find((r) => r.semver === '1.1.0')?.state).toBe('CANARY');
      expect(rows.find((r) => r.semver === '1.1.0')?.canary_kiosk_codes).toEqual(['MK-OPD-01']);
    });
  });

  describe('rollback', () => {
    it('needs a stated reason', async () => {
      const id = await draft();
      await approveFully(id);
      await move(id, { to: 'CANARY', canaryKioskCodes: ['MK-OPD-01'] }).expect(201);
      await move(id, { to: 'ROLLED_BACK' }).expect(400);
      await move(id, { to: 'ROLLED_BACK', rollbackReason: 'too short' }).expect(400);
    });

    it('records who rolled back, when and why', async () => {
      const id = await draft();
      await approveFully(id);
      await move(id, { to: 'PUBLISHED' }).expect(201);
      await move(id, {
        to: 'ROLLED_BACK',
        rollbackReason: 'the Hindi translation of question four is wrong',
      }).expect(201);

      const row = await db
        .selectFrom('governance_version')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row.state).toBe('ROLLED_BACK');
      expect(row.rollback_reason).toContain('Hindi translation');
      expect(row.rolled_back_by_user_id).not.toBeNull();
    });

    it('restores the version it replaced, so the kiosk is not left with nothing', async () => {
      const first = await draft({ semver: '1.0.0' });
      await approveFully(first);
      await move(first, { to: 'PUBLISHED' }).expect(201);

      // The rollback pointer is derived from whatever is live, so the author does not
      // have to supply it — and cannot get it wrong under pressure.
      const second = await draft({ semver: '2.0.0' });
      const secondRow = await db
        .selectFrom('governance_version')
        .selectAll()
        .where('id', '=', second)
        .executeTakeFirstOrThrow();
      expect(secondRow.rollback_to_id).toBe(first);

      await approveFully(second);
      await move(second, { to: 'PUBLISHED' }).expect(201);

      // Publishing retired the first.
      let firstRow = await db
        .selectFrom('governance_version')
        .selectAll()
        .where('id', '=', first)
        .executeTakeFirstOrThrow();
      expect(firstRow.state).toBe('RETIRED');

      await move(second, {
        to: 'ROLLED_BACK',
        rollbackReason: 'severity scale renders wrongly on the 10-inch kiosks',
      }).expect(201);

      firstRow = await db
        .selectFrom('governance_version')
        .selectAll()
        .where('id', '=', first)
        .executeTakeFirstOrThrow();
      // A rollback that leaves nothing live is an outage: the kiosk finds no published
      // questionnaire and stops.
      expect(firstRow.state).toBe('PUBLISHED');
    });

    it('never returns a rolled-back version to circulation', async () => {
      const id = await draft();
      await approveFully(id);
      await move(id, { to: 'PUBLISHED' }).expect(201);
      await move(id, { to: 'ROLLED_BACK', rollbackReason: 'wrong content shipped' }).expect(201);

      // The version number is what a clinical record cites. It must keep meaning one thing.
      await move(id, { to: 'PUBLISHED' }).expect(409);
      await move(id, { to: 'DRAFT' }).expect(409);
    });
  });

  describe('every release is audited', () => {
    it('records each transition with who did it', async () => {
      const id = await draft();
      await approveFully(id);
      await move(id, { to: 'PUBLISHED' }).expect(201);

      const res = await http()
        .get(`/v1/governance/releases/${id}/history`)
        .set(as(reviewerToken))
        .expect(200);

      const states = res.body.transitions.map((t: { to_state: string }) => t.to_state);
      expect(states).toEqual(['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED']);
      expect(res.body.transitions.every((t: { actor_user_id: string }) => t.actor_user_id)).toBe(
        true,
      );
    });

    it('writes an audit event for the release itself', async () => {
      const id = await draft();
      await approveFully(id);
      await move(id, { to: 'PUBLISHED' }).expect(201);

      const events = await db
        .selectFrom('audit_event')
        .selectAll()
        .where('action', '=', 'GOVERNANCE_RELEASE_TRANSITIONED')
        .execute();
      expect(events.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('no live content lacks a version', () => {
    it('reports what a hospital is missing, per language', async () => {
      const res = await http().get('/v1/governance/unversioned').set(as(reviewerToken)).expect(200);

      // A hospital offering Hindi with no Hindi consent notice is not partly ready — it
      // is a kiosk that stops dead for every Hindi speaker.
      const keys = res.body.missing.map((m: { key: string }) => m.key);
      expect(keys).toContain('common-core/en');
    });

    it('stops reporting a kind once it is published', async () => {
      const id = await draft();
      await approveFully(id);
      await move(id, { to: 'PUBLISHED' }).expect(201);

      const res = await http().get('/v1/governance/unversioned').set(as(reviewerToken)).expect(200);
      const keys = res.body.missing.map((m: { key: string }) => m.key);
      expect(keys).not.toContain('common-core/en');
    });
  });
});
