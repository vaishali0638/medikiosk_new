import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import type { DocumentType } from '@medikiosk/api-contracts';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import type { DocumentRow, OcrExtractionRow } from '../db/database.types';
import { DomainError } from '../common/domain-error';
import { AuditRepository } from '../audit/audit.repository';
import { ConsentService } from '../consent/consent.service';
import { MalwareScanner, validateUpload } from './file-validation';
import { ObjectStore } from './object-store';

/** The kiosk-visible view of an attached document. */
export interface DocumentSummary {
  documentId: string;
  documentType: DocumentType;
  state: DocumentRow['state'];
  contentType: string;
  /** A string: the column is bigint, and node-postgres returns those as text rather than
   *  silently rounding through a double. */
  byteSize: string;
  uploadedAt: Date;
  extractionState: OcrExtractionRow['review_state'] | null;
}

export interface UploadInput {
  readonly preCheckinId: string;
  readonly patientId: string;
  readonly documentType: DocumentType;
  readonly contentType: string;
  readonly bytes: Buffer;
  readonly originalFilename?: string | undefined;
  readonly documentDate?: string | undefined;
  readonly correlationId: string;
  readonly actorId: string;
}

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly store: ObjectStore,
    private readonly scanner: MalwareScanner,
    private readonly consents: ConsentService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Accepts an original document.
   *
   * Order: consent, cheap validation, malware scan, encrypt and store, THEN record. The
   * row is written last so a `document` row always refers to bytes that exist and have
   * been scanned — the alternative leaves a record pointing at nothing, which is worse
   * than no record because it looks like the document was captured.
   *
   * An extraction job is queued in the same transaction as the row, so a document can
   * never be stored without one, and a crash between the two cannot lose the job.
   */
  async upload(input: UploadInput): Promise<DocumentRow> {
    await this.consents.requireActiveConsent(input.patientId, input.correlationId);

    const invalid = validateUpload(input.bytes, input.contentType);
    if (invalid) {
      await this.recordRejection(input, invalid.reason, invalid.detail);
      throw new DomainError('VALIDATION_FAILED', input.correlationId, invalid.detail);
    }

    const verdict = await this.scanner.scan(input.bytes, input.contentType);
    if (!verdict.clean) {
      await this.recordRejection(input, verdict.reason, `scanner: ${this.scanner.kind}`);
      throw new DomainError('VALIDATION_FAILED', input.correlationId, verdict.reason);
    }

    // Server-generated key. The patient's filename never touches the path — it is
    // attacker-controlled and only stored for the doctor's benefit.
    const objectKey = `${input.preCheckinId}/${randomUUID()}`;
    const stored = await this.store.put(objectKey, input.bytes);

    return this.db.transaction().execute(async (trx) => {
      const document = await trx
        .insertInto('document')
        .values({
          pre_checkin_id: input.preCheckinId,
          patient_id: input.patientId,
          document_type: input.documentType,
          object_key: stored.objectKey,
          content_type: input.contentType,
          byte_size: String(stored.byteSize),
          sha256: stored.sha256,
          encryption_key_id: stored.encryptionKeyId,
          original_filename: input.originalFilename ?? null,
          document_date: input.documentDate ? new Date(input.documentDate) : null,
          state: 'STORED',
          malware_scanned_at: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Queued in the same transaction: a stored document without a job would never be
      // read, and a job without a document would have nothing to read.
      await trx
        .insertInto('ocr_extraction')
        .values({
          document_id: document.id,
          extractor_version: 'pending',
          review_state: 'PENDING',
        })
        .execute();

      await this.audit.append(
        {
          actorId: input.actorId,
          actorRole: 'PATIENT',
          action: 'DOCUMENT_STORED',
          entityType: 'document',
          entityId: document.id,
          correlationId: input.correlationId,
          detail: {
            documentType: input.documentType,
            contentType: input.contentType,
            byteSize: stored.byteSize,
            sha256: stored.sha256,
          },
        },
        trx,
      );

      return document;
    });
  }

  /**
   * Returns the original bytes, verifying the hash before handing them over.
   *
   * The hash was taken of the plaintext the patient uploaded. Checking it on the way out
   * turns "the original is never silently modified" from a promise into something the
   * system detects — corruption, a restore from the wrong backup, or tampering all
   * surface here rather than in front of a clinician.
   */
  async readOriginal(
    documentId: string,
    correlationId: string,
  ): Promise<{
    bytes: Buffer;
    document: DocumentRow;
  }> {
    const document = await this.db
      .selectFrom('document')
      .selectAll()
      .where('id', '=', documentId)
      .executeTakeFirst();

    if (!document || document.state !== 'STORED') {
      throw new DomainError('VALIDATION_FAILED', correlationId, 'no such stored document');
    }

    const bytes = await this.store.get(document.object_key);

    const { createHash } = await import('node:crypto');
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== document.sha256) {
      this.logger.error(
        `Document ${documentId} failed its integrity check: stored ${document.sha256}, read ${actual}`,
      );
      await this.audit.append({
        actorId: 'SYSTEM',
        actorRole: 'SYSTEM',
        action: 'DOCUMENT_INTEGRITY_FAILURE',
        entityType: 'document',
        entityId: documentId,
        correlationId,
        detail: { expected: document.sha256, actual },
      });
      throw new DomainError('INTERNAL_ERROR', correlationId, 'document integrity check failed');
    }

    return { bytes, document };
  }

  /** Documents attached to a visit, with the state of their extraction. */
  /**
   * What a kiosk may know about the documents on a visit.
   *
   * Two fields are deliberately absent. `rejection_reason` would tell a device standing
   * in a public waiting room exactly which check caught a file — magic bytes, size, or a
   * malware signature — which is precisely the feedback someone probing the uploader
   * needs to tune around it. `overall_confidence` would let a client rank extractions and
   * present the confident ones as settled, which is the failure this whole phase exists
   * to prevent. Both stay server-side; the doctor's review surface reads them from the
   * row directly.
   */
  async listForPreCheckin(preCheckinId: string): Promise<DocumentSummary[]> {
    return this.db
      .selectFrom('document')
      .leftJoin('ocr_extraction', 'ocr_extraction.document_id', 'document.id')
      .select([
        'document.id as documentId',
        'document.document_type as documentType',
        'document.state as state',
        'document.content_type as contentType',
        'document.byte_size as byteSize',
        'document.uploaded_at as uploadedAt',
        'ocr_extraction.review_state as extractionState',
      ])
      .where('document.pre_checkin_id', '=', preCheckinId)
      .orderBy('document.uploaded_at', 'asc')
      .execute();
  }

  /**
   * Records a refused upload.
   *
   * The rejected bytes are never stored. The row exists so a patient who tried three
   * times and gave up is visible to the hospital, and so a pattern of malware uploads at
   * one kiosk is visible to security.
   */
  private async recordRejection(input: UploadInput, reason: string, detail: string): Promise<void> {
    await this.db
      .insertInto('document')
      .values({
        pre_checkin_id: input.preCheckinId,
        patient_id: input.patientId,
        document_type: input.documentType,
        // No bytes were kept, but the column is NOT NULL and unique — a synthetic key
        // marks the absence explicitly rather than inventing a plausible one.
        object_key: `rejected/${randomUUID()}`,
        content_type: input.contentType,
        byte_size: String(Math.max(input.bytes.byteLength, 1)),
        sha256: '0'.repeat(64),
        original_filename: input.originalFilename ?? null,
        state: reason === 'EICAR_TEST_SIGNATURE' ? 'REJECTED_MALWARE' : 'REJECTED_INVALID',
        rejection_reason: reason,
      })
      .execute();

    await this.audit.append({
      actorId: input.actorId,
      actorRole: 'PATIENT',
      action: 'DOCUMENT_REJECTED',
      entityType: 'pre_checkin',
      entityId: input.preCheckinId,
      correlationId: input.correlationId,
      detail: { reason, detail, contentType: input.contentType },
    });
  }

  /**
   * Claims extraction jobs due for an attempt.
   *
   * `FOR UPDATE SKIP LOCKED` inside the subquery is what makes this a safe queue: two
   * workers polling at the same instant take disjoint sets rather than blocking on each
   * other or both grabbing the same row. PostgreSQL does not allow LIMIT on an UPDATE, so
   * the selection and the claim are separate statements inside one query.
   *
   * The stale-claim window releases a job whose worker died holding it — without it, one
   * crash would strand a document unread forever.
   */
  async claimPendingExtractions(workerId: string, limit = 10): Promise<OcrExtractionRow[]> {
    const { rows } = await sql<OcrExtractionRow>`
      UPDATE ocr_extraction
         SET claimed_at = now(), claimed_by = ${workerId}
       WHERE id IN (
         SELECT id
           FROM ocr_extraction
          WHERE review_state = 'PENDING'
            AND next_attempt_at <= now()
            AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
          ORDER BY next_attempt_at ASC
          LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
       )
      RETURNING *
    `.execute(this.db);

    return rows;
  }
}
