import { randomUUID, createHash } from 'node:crypto';
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
import { ExtractionService } from '../src/documents/extraction.service';
import { OcrAdapter, type OcrResult } from '../src/documents/ocr.adapter';
import { createTestDb, seedFixture, truncateAll, type Fixture } from './db-fixture';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

const jpeg = (payload = 'scanned prescription'): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(payload, 'utf8')]);

/**
 * Swappable OCR, so a test can install an outcome.
 *
 * The "extracted" fields are deliberately generic — `fieldOne`, `fieldTwo` — rather than
 * medicine names and doses. A fixture that read like a real prescription extraction would
 * end up copied somewhere it should not be, and this repository must not contain clinical
 * text no clinician wrote.
 */
class SwitchableOcr extends OcrAdapter {
  readonly kind = 'switchable';
  result: OcrResult = { outcome: 'UNAVAILABLE', detail: 'no worker' };
  calls = 0;

  async extract(): Promise<OcrResult> {
    this.calls += 1;
    return this.result;
  }
}

describe('documents and extraction (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let db: Kysely<Database>;
  let fx: Fixture;
  let preCheckinId: string;
  let ocr: SwitchableOcr;
  let extractions: ExtractionService;

  const http = () => request(app.getHttpServer());
  const headers = (): Record<string, string> => ({
    [KIOSK_DEVICE_HEADER]: 'MK-OPD-01',
    [CORRELATION_ID_HEADER]: randomUUID(),
  });

  const upload = (bytes: Buffer, contentType = 'image/jpeg', documentType = 'PRESCRIPTION') =>
    http()
      .post(`/v1/precheckins/${preCheckinId}/documents`)
      .set(headers())
      .send({ documentType, contentType, data: bytes.toString('base64') });

  beforeAll(async () => {
    // Adapters are selected at import time; see test/setup-integration.ts.
    db = await createTestDb();
    ocr = new SwitchableOcr();
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OcrAdapter)
      .useValue(ocr)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix(API_BASE_PATH.replace(/^\//, ''), { exclude: ['health', 'health/ready'] });
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
    extractions = moduleRef.get(ExtractionService);
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
    ocr.result = { outcome: 'UNAVAILABLE', detail: 'no worker' };
    ocr.calls = 0;

    const consent = await db
      .insertInto('consent')
      .values({
        patient_id: fx.patientId,
        hospital_id: fx.hospitalId,
        purpose: 'OPD clinical intake and consultation',
        data_categories: ['demographics', 'medical-documents'],
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

  describe('storing an original', () => {
    it('accepts a clean document and records its hash', async () => {
      const bytes = jpeg();
      const res = await upload(bytes).expect(201);

      expect(res.body.state).toBe('STORED');
      expect(res.body.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      // The doctor gets a label, not a reading, and the client is told so explicitly.
      expect(res.body.extraction).toBe('QUEUED');
    });

    it('returns exactly the bytes that went in', async () => {
      const bytes = jpeg('a very specific prescription');
      const uploaded = await upload(bytes).expect(201);

      const res = await http()
        .get(`/v1/documents/${uploaded.body.documentId}/original`)
        .set(headers())
        .expect(200);

      expect(Buffer.from(res.body as Buffer)).toEqual(bytes);
    });

    it('serves the original with headers that stop a viewer executing it', async () => {
      const uploaded = await upload(jpeg()).expect(201);
      const res = await http()
        .get(`/v1/documents/${uploaded.body.documentId}/original`)
        .set(headers())
        .expect(200);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).toBe('attachment');
      expect(res.headers['cache-control']).toContain('no-store');
    });

    it('queues exactly one extraction per document', async () => {
      const uploaded = await upload(jpeg()).expect(201);
      const jobs = await db
        .selectFrom('ocr_extraction')
        .selectAll()
        .where('document_id', '=', uploaded.body.documentId)
        .execute();

      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.review_state).toBe('PENDING');
    });

    it('refuses an upload without active consent', async () => {
      await db.updateTable('consent').set({ state: 'REVOKED', revoked_at: new Date() }).execute();
      await upload(jpeg()).expect(403);
      expect(await db.selectFrom('document').selectAll().execute()).toEqual([]);
    });
  });

  describe('refusing an upload', () => {
    it('refuses a file carrying the EICAR signature and stores no bytes', async () => {
      const infected = Buffer.concat([jpeg(), Buffer.from(EICAR, 'ascii')]);
      await upload(infected).expect(400);

      const row = await db.selectFrom('document').selectAll().executeTakeFirstOrThrow();
      expect(row.state).toBe('REJECTED_MALWARE');
      expect(row.rejection_reason).toBe('EICAR_TEST_SIGNATURE');
      // A rejected upload is recorded but never stored, so there is nothing to encrypt.
      expect(row.encryption_key_id).toBeNull();
    });

    it('refuses a file lying about its type', async () => {
      const pdfBytes = Buffer.from('%PDF-1.7 pretending to be a photo', 'latin1');
      await upload(pdfBytes, 'image/jpeg').expect(400);

      const row = await db.selectFrom('document').selectAll().executeTakeFirstOrThrow();
      expect(row.rejection_reason).toBe('CONTENT_TYPE_MISMATCH');
      expect(row.state).toBe('REJECTED_INVALID');
    });

    it('refuses an empty file', async () => {
      await http()
        .post(`/v1/precheckins/${preCheckinId}/documents`)
        .set(headers())
        .send({ documentType: 'PRESCRIPTION', contentType: 'image/jpeg', data: '' })
        .expect(400);
    });

    it('audits a refusal so a pattern at one kiosk is visible', async () => {
      await upload(Buffer.concat([jpeg(), Buffer.from(EICAR, 'ascii')])).expect(400);
      const event = await db
        .selectFrom('audit_event')
        .selectAll()
        .where('action', '=', 'DOCUMENT_REJECTED')
        .executeTakeFirstOrThrow();
      expect(event.detail).toMatchObject({ reason: 'EICAR_TEST_SIGNATURE' });
    });
  });

  describe('integrity', () => {
    it('refuses to serve a document whose bytes no longer match its hash', async () => {
      const uploaded = await upload(jpeg()).expect(201);
      await db
        .updateTable('document')
        .set({ sha256: 'f'.repeat(64) })
        .where('id', '=', uploaded.body.documentId)
        .execute();

      // Corruption, a restore from the wrong backup, or tampering all surface here rather
      // than in front of a clinician.
      await http()
        .get(`/v1/documents/${uploaded.body.documentId}/original`)
        .set(headers())
        .expect(500);

      const event = await db
        .selectFrom('audit_event')
        .selectAll()
        .where('action', '=', 'DOCUMENT_INTEGRITY_FAILURE')
        .executeTakeFirst();
      expect(event).toBeDefined();
    });
  });

  describe('extraction', () => {
    it('leaves the job pending when no OCR worker is available', async () => {
      await upload(jpeg()).expect(201);
      const result = await extractions.sweep('worker-1', randomUUID());

      expect(result.unavailable).toBe(1);
      const job = await db.selectFrom('ocr_extraction').selectAll().executeTakeFirstOrThrow();
      // Not a failure: there is simply no worker. The original is stored and the doctor
      // sees the scan.
      expect(job.review_state).toBe('PENDING');
      expect(job.last_error_code).toBe('OCR_UNAVAILABLE');
    });

    it('records an extraction as a review candidate, never as a record', async () => {
      const uploaded = await upload(jpeg()).expect(201);
      ocr.result = {
        outcome: 'EXTRACTED',
        fields: [
          { name: 'fieldOne', value: 'value one', confidence: 0.97 },
          { name: 'fieldTwo', value: 'value two', confidence: 0.42 },
        ],
        rawText: 'raw text',
        overallConfidence: 0.7,
        extractorVersion: 'test-1.0.0',
      };

      await extractions.sweep('worker-1', randomUUID());

      const res = await http()
        .get(`/v1/documents/${uploaded.body.documentId}/extraction`)
        .set(headers())
        .expect(200);

      // AWAITING_CLINICIAN_REVIEW and no further. Only Phase 13 promotes anything out.
      expect(res.body.reviewState).toBe('AWAITING_CLINICIAN_REVIEW');
      expect(res.body.fields).toHaveLength(2);
    });

    it('flags low-confidence fields individually', async () => {
      const uploaded = await upload(jpeg()).expect(201);
      ocr.result = {
        outcome: 'EXTRACTED',
        fields: [
          { name: 'fieldOne', value: 'crisp', confidence: 0.97 },
          { name: 'fieldTwo', value: 'illegible', confidence: 0.42 },
        ],
        rawText: 'raw',
        overallConfidence: 0.7,
        extractorVersion: 'test-1.0.0',
      };
      await extractions.sweep('worker-1', randomUUID());

      const res = await http()
        .get(`/v1/documents/${uploaded.body.documentId}/extraction`)
        .set(headers())
        .expect(200);

      const fields = res.body.fields as Array<{ needsVerification: boolean; label: string }>;
      // Per field, not per document: a document-level score would hide exactly the
      // difference that matters.
      expect(fields[0]?.needsVerification).toBe(false);
      expect(fields[1]?.needsVerification).toBe(true);
      expect(fields[0]?.label).toContain('OCR-EXTRACTED');
    });

    it('never writes to a medication, allergy or diagnosis record', async () => {
      await upload(jpeg()).expect(201);
      ocr.result = {
        outcome: 'EXTRACTED',
        fields: [{ name: 'medicineName', value: 'Something', confidence: 0.99 }],
        rawText: 'raw',
        overallConfidence: 0.99,
        extractorVersion: 'test-1.0.0',
      };
      await extractions.sweep('worker-1', randomUUID());

      // Even a maximally confident extraction changes nothing about the patient.
      expect(await db.selectFrom('questionnaire_response').selectAll().execute()).toEqual([]);
      const patient = await db
        .selectFrom('patient')
        .selectAll()
        .where('id', '=', fx.patientId)
        .executeTakeFirstOrThrow();
      expect(patient.version).toBe(1);
    });

    it('keeps the original when extraction fails repeatedly', async () => {
      const uploaded = await upload(jpeg()).expect(201);
      ocr.result = { outcome: 'FAILED', errorCode: 'UNREADABLE' };

      for (let i = 0; i < 3; i += 1) {
        await db
          .updateTable('ocr_extraction')
          .set({ next_attempt_at: new Date(Date.now() - 1000), claimed_at: null })
          .execute();
        await extractions.sweep('worker-1', randomUUID());
      }

      const job = await db.selectFrom('ocr_extraction').selectAll().executeTakeFirstOrThrow();
      expect(job.review_state).toBe('FAILED');
      expect(job.last_error_code).toBe('UNREADABLE');

      // FAILED, not deleted. The doctor still gets the original.
      const doc = await db.selectFrom('document').selectAll().executeTakeFirstOrThrow();
      expect(doc.state).toBe('STORED');
      await http()
        .get(`/v1/documents/${uploaded.body.documentId}/original`)
        .set(headers())
        .expect(200);
    });

    it('does not process a job before its backoff has elapsed', async () => {
      await upload(jpeg()).expect(201);
      ocr.result = { outcome: 'FAILED', errorCode: 'UNREADABLE' };
      await extractions.sweep('worker-1', randomUUID());

      const before = ocr.calls;
      await extractions.sweep('worker-1', randomUUID());
      expect(ocr.calls).toBe(before);
    });

    it('does not let two workers claim the same job', async () => {
      await upload(jpeg()).expect(201);
      ocr.result = { outcome: 'FAILED', errorCode: 'UNREADABLE' };

      const [a, b] = await Promise.all([
        extractions.sweep('worker-a', randomUUID()),
        extractions.sweep('worker-b', randomUUID()),
      ]);
      expect(a.claimed + b.claimed).toBe(1);
    });
  });

  describe('listing', () => {
    it('shows the extraction state alongside each document', async () => {
      await upload(jpeg(), 'image/jpeg', 'PRESCRIPTION').expect(201);
      await upload(jpeg('lab'), 'image/jpeg', 'LAB_REPORT').expect(201);

      const res = await http()
        .get(`/v1/precheckins/${preCheckinId}/documents`)
        .set(headers())
        .expect(200);

      expect(res.body.documents).toHaveLength(2);
      expect(res.body.documents[0].documentId).toEqual(expect.any(String));
      expect(res.body.documents[0].documentType).toBe('PRESCRIPTION');
      expect(res.body.documents[0].extractionState).toBe('PENDING');
    });

    it('withholds the rejection reason and the confidence from the kiosk', async () => {
      await upload(Buffer.concat([jpeg(), Buffer.from(EICAR, 'ascii')])).expect(400);
      await upload(jpeg(), 'image/jpeg', 'PRESCRIPTION').expect(201);

      const res = await http()
        .get(`/v1/precheckins/${preCheckinId}/documents`)
        .set(headers())
        .expect(200);

      for (const document of res.body.documents) {
        // Which check caught a file is exactly what someone probing the uploader from the
        // waiting room wants to learn, and a confidence number invites a client to treat
        // the confident extractions as settled. Neither leaves the server.
        expect(document).not.toHaveProperty('rejectionReason');
        expect(document).not.toHaveProperty('overallConfidence');
      }
    });
  });
});
