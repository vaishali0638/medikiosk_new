import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import { withSerializableRetry } from '../db/transaction';
import { DomainError } from '../common/domain-error';
import { AuditRepository } from '../audit/audit.repository';

/** One answer the patient changed on the review screen itself. */
export interface Correction {
  readonly questionId: string;
  readonly fromRevision: number;
  readonly toRevision: number;
}

export interface SubmitInput {
  readonly preCheckinId: string;
  readonly consentId: string;
  readonly kioskSessionId?: string | undefined;
  readonly kioskDeviceId?: string | undefined;
  readonly questionnaireKey: string;
  readonly questionnaireVersion: string;
  readonly ayushModuleVersion?: string | undefined;
  readonly languageTag: string;
  /** The patient pressed "I reviewed and want to submit". */
  readonly reviewConfirmed: boolean;
  readonly answerRevisions: Record<string, number>;
  readonly corrections: readonly Correction[];
  readonly correlationId: string;
  readonly actorId: string;
}

export interface SubmissionResult {
  readonly submissionId: string;
  readonly submittedAt: Date;
  /** True when this call found an existing submission rather than creating one. */
  readonly alreadySubmitted: boolean;
}

@Injectable()
export class SubmissionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Records the patient's confirmed review.
   *
   * Two things make "a patient cannot submit without review confirmation" true rather
   * than merely intended. The check below refuses an unconfirmed call; and
   * `review_confirmed boolean NOT NULL CHECK (review_confirmed)` means that even if this
   * check were deleted in a refactor, the database would still refuse the row. The
   * application check exists to give a useful error, not to be the control.
   *
   * Idempotent by unique constraint on `pre_checkin_id`: a patient who presses the button
   * twice, or a kiosk that retries a timed-out request, has submitted once.
   */
  async submit(input: SubmitInput): Promise<SubmissionResult> {
    if (!input.reviewConfirmed) {
      throw new DomainError(
        'VALIDATION_FAILED',
        input.correlationId,
        'submission requires review confirmation',
      );
    }

    return withSerializableRetry(this.db, async (trx) => {
      const existing = await trx
        .selectFrom('intake_submission')
        .select(['id', 'submitted_at'])
        .where('pre_checkin_id', '=', input.preCheckinId)
        .executeTakeFirst();

      if (existing) {
        return {
          submissionId: existing.id,
          submittedAt: existing.submitted_at,
          alreadySubmitted: true,
        };
      }

      const row = await trx
        .insertInto('intake_submission')
        .values({
          pre_checkin_id: input.preCheckinId,
          kiosk_session_id: input.kioskSessionId ?? null,
          kiosk_device_id: input.kioskDeviceId ?? null,
          consent_id: input.consentId,
          questionnaire_key: input.questionnaireKey,
          questionnaire_version: input.questionnaireVersion,
          ayush_module_version: input.ayushModuleVersion ?? null,
          language_tag: input.languageTag,
          review_confirmed: true,
          // When the patient confirmed, not when the row was written. A slow request must
          // not move the moment of consent to the intake.
          reviewed_at: new Date(),
          answer_revisions: JSON.stringify(input.answerRevisions) as never,
          corrections: JSON.stringify(input.corrections) as never,
          correlation_id: input.correlationId,
        })
        .returning(['id', 'submitted_at'])
        .executeTakeFirstOrThrow();

      // In the transaction: the log cannot claim a submission that rolled back, nor miss
      // one that committed.
      await this.audit.append(
        {
          actorId: input.actorId,
          actorRole: 'kiosk',
          action: 'INTAKE_SUBMITTED',
          entityType: 'intake_submission',
          entityId: row.id,
          correlationId: input.correlationId,
          detail: {
            questionnaireVersion: input.questionnaireVersion,
            ayushModuleVersion: input.ayushModuleVersion ?? null,
            languageTag: input.languageTag,
            // Counts only. Which answers a patient corrected on the review screen is
            // clinical content, and it is in the row, not in the log.
            answerCount: Object.keys(input.answerRevisions).length,
            correctionCount: input.corrections.length,
          },
        },
        trx,
      );

      return { submissionId: row.id, submittedAt: row.submitted_at, alreadySubmitted: false };
    });
  }

  async findByPreCheckin(preCheckinId: string): Promise<{ id: string; submittedAt: Date } | null> {
    const row = await this.db
      .selectFrom('intake_submission')
      .select(['id', 'submitted_at'])
      .where('pre_checkin_id', '=', preCheckinId)
      .executeTakeFirst();

    return row ? { id: row.id, submittedAt: row.submitted_at } : null;
  }
}
