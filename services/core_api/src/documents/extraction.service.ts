import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import { AuditRepository } from '../audit/audit.repository';
import { DocumentService } from './document.service';
import { OcrAdapter } from './ocr.adapter';

/** Below this, a field is flagged for the doctor rather than presented as read. */
export const LOW_CONFIDENCE_THRESHOLD = 0.85;

const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_SECONDS = [60, 300, 900];

export interface ExtractionSweepResult {
  readonly claimed: number;
  readonly extracted: number;
  readonly failed: number;
  readonly unavailable: number;
}

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly documents: DocumentService,
    private readonly ocr: OcrAdapter,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Processes queued extractions.
   *
   * Asynchronous by construction: nothing in the upload path waits for this, and nothing
   * in the token path depends on it. A patient gets their token whether or not their
   * prescription has been read, which is the point — OCR is a convenience for the doctor,
   * not a gate on care.
   *
   * Every outcome leaves the ORIGINAL untouched. There is no path here that writes to
   * `document`, deletes an object, or touches a medication, allergy or diagnosis record.
   */
  async sweep(workerId: string, correlationId: string): Promise<ExtractionSweepResult> {
    const claimed = await this.documents.claimPendingExtractions(workerId);
    let extracted = 0;
    let failed = 0;
    let unavailable = 0;

    for (const job of claimed) {
      try {
        const { bytes, document } = await this.documents.readOriginal(
          job.document_id,
          correlationId,
        );

        const result = await this.ocr.extract(bytes, document.content_type, document.document_type);

        if (result.outcome === 'UNAVAILABLE') {
          // Not a failure and not a retry storm: there is simply no worker. The job waits,
          // the original is stored, and the doctor sees the scan.
          await this.reschedule(job.id, 'OCR_UNAVAILABLE', job.attempt_count);
          unavailable += 1;
          continue;
        }

        if (result.outcome === 'FAILED') {
          await this.reschedule(job.id, result.errorCode, job.attempt_count);
          failed += 1;
          continue;
        }

        await this.recordExtraction(job.id, job.document_id, result, correlationId);
        extracted += 1;
      } catch (error) {
        // A job that throws must not take the document with it. The original is already
        // stored and hashed; the worst case here is that nobody read it.
        this.logger.warn(
          `Extraction ${job.id} threw: ${error instanceof Error ? error.message : 'unknown'}`,
        );
        await this.reschedule(job.id, 'EXTRACTOR_THREW', job.attempt_count);
        failed += 1;
      }
    }

    return { claimed: claimed.length, extracted, failed, unavailable };
  }

  /**
   * Stores an extraction as a REVIEW CANDIDATE.
   *
   * The review state goes to AWAITING_CLINICIAN_REVIEW and never further. Nothing here
   * writes to a medication, allergy or diagnosis record, and there is no code path that
   * can: the extraction lives in its own table, and only a clinician's explicit
   * confirmation in Phase 13 promotes anything out of it.
   */
  private async recordExtraction(
    extractionId: string,
    documentId: string,
    result: Extract<Awaited<ReturnType<OcrAdapter['extract']>>, { outcome: 'EXTRACTED' }>,
    correlationId: string,
  ): Promise<void> {
    const fields = result.fields.map((field) => ({
      ...field,
      // Per FIELD, not per document: a prescription can be crisp in the patient name and
      // illegible in the dose, and one score would hide exactly that difference.
      needsVerification: field.confidence < LOW_CONFIDENCE_THRESHOLD,
      label: 'OCR-EXTRACTED — VERIFY',
    }));

    await this.db
      .updateTable('ocr_extraction')
      .set({
        extractor_version: result.extractorVersion,
        fields: JSON.stringify(fields),
        raw_text: result.rawText,
        overall_confidence: result.overallConfidence,
        review_state: 'AWAITING_CLINICIAN_REVIEW',
        claimed_at: null,
        claimed_by: null,
        last_error_code: null,
      })
      .where('id', '=', extractionId)
      .execute();

    await this.audit.append({
      actorId: 'SYSTEM',
      actorRole: 'SYSTEM',
      action: 'DOCUMENT_EXTRACTED',
      entityType: 'ocr_extraction',
      entityId: extractionId,
      correlationId,
      detail: {
        documentId,
        extractorVersion: result.extractorVersion,
        fieldCount: fields.length,
        lowConfidenceCount: fields.filter((f) => f.needsVerification).length,
      },
    });
  }

  /** Backs a job off, or gives up after the allowance without touching the original. */
  private async reschedule(
    extractionId: string,
    errorCode: string,
    attempts: number,
  ): Promise<void> {
    const next = attempts + 1;
    const exhausted = next >= MAX_ATTEMPTS;
    const backoff =
      RETRY_BACKOFF_SECONDS[Math.min(attempts, RETRY_BACKOFF_SECONDS.length - 1)] ?? 900;

    await this.db
      .updateTable('ocr_extraction')
      .set({
        attempt_count: next,
        last_error_code: errorCode,
        claimed_at: null,
        claimed_by: null,
        // FAILED, not deleted. The doctor still gets the original; they just get no
        // extraction alongside it, and the record says why.
        ...(exhausted ? { review_state: 'FAILED' as const } : {}),
        next_attempt_at: sql<Date>`now() + make_interval(secs => ${backoff})`,
      })
      .where('id', '=', extractionId)
      .execute();
  }

  /** What the doctor's view reads. Candidates only — nothing here is a clinical record. */
  async findForDocument(documentId: string) {
    return this.db
      .selectFrom('ocr_extraction')
      .selectAll()
      .where('document_id', '=', documentId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
  }
}
