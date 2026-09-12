import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { ConsentCaptureMethod, ConsentDataCategory } from '@medikiosk/api-contracts';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import type { ConsentRow } from '../db/database.types';
import { withSerializableRetry, type DbExecutor } from '../db/transaction';
import { consentMachine } from '../state-machines';
import { AuditRepository } from '../audit/audit.repository';

export interface CaptureConsentInput {
  readonly patientId: string;
  readonly hospitalId: string;
  readonly purpose: string;
  readonly dataCategories: readonly ConsentDataCategory[];
  readonly languageTag: string;
  readonly noticeVersion: string;
  readonly captureMethod: ConsentCaptureMethod;
  readonly kioskDeviceId?: string | undefined;
  readonly validUntil: Date;
  readonly decision: 'GRANTED' | 'DECLINED';
  readonly correlationId: string;
  readonly actorId: string;
}

@Injectable()
export class ConsentRepository {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Captures a consent decision and its audit event in one transaction.
   *
   * The artefact is created in PENDING and immediately transitioned, rather than
   * inserted directly as GRANTED, so the transition passes through the same state
   * machine every later change does. A decline is recorded, not discarded: the hospital
   * must be able to show what the patient was asked and what they answered.
   */
  async capture(input: CaptureConsentInput): Promise<ConsentRow> {
    consentMachine.assertTransition('PENDING', input.decision);

    return withSerializableRetry(this.db, async (trx) => {
      const row = await trx
        .insertInto('consent')
        .values({
          patient_id: input.patientId,
          hospital_id: input.hospitalId,
          purpose: input.purpose,
          data_categories: [...input.dataCategories],
          language_tag: input.languageTag,
          notice_version: input.noticeVersion,
          state: input.decision,
          capture_method: input.captureMethod,
          kiosk_device_id: input.kioskDeviceId ?? null,
          valid_until: input.validUntil,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.audit.append(
        {
          actorId: input.actorId,
          actorRole: 'PATIENT',
          action: `CONSENT_${input.decision}`,
          entityType: 'consent',
          entityId: row.id,
          correlationId: input.correlationId,
          detail: {
            noticeVersion: input.noticeVersion,
            language: input.languageTag,
            categories: input.dataCategories,
          },
        },
        trx,
      );

      return row;
    });
  }

  /**
   * Returns the consent currently authorising processing for a patient, or null.
   *
   * Expiry is evaluated against the database clock rather than the application's, so a
   * kiosk with a skewed system time cannot extend a consent past its validity window.
   */
  async findActive(
    patientId: string,
    executor: DbExecutor = this.db,
  ): Promise<ConsentRow | undefined> {
    return executor
      .selectFrom('consent')
      .selectAll()
      .where('patient_id', '=', patientId)
      .where('state', '=', 'GRANTED')
      .where('valid_until', '>', sql<Date>`now()`)
      .orderBy('captured_at', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  async findById(id: string, executor: DbExecutor = this.db): Promise<ConsentRow | undefined> {
    return executor.selectFrom('consent').selectAll().where('id', '=', id).executeTakeFirst();
  }

  /** Withdraws a granted consent. Withdrawal is recorded, never a delete. */
  async revoke(consentId: string, correlationId: string, actorId: string): Promise<ConsentRow> {
    return withSerializableRetry(this.db, async (trx) => {
      const current = await trx
        .selectFrom('consent')
        .selectAll()
        .where('id', '=', consentId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      consentMachine.assertTransition(current.state, 'REVOKED');

      const row = await trx
        .updateTable('consent')
        .set({ state: 'REVOKED', revoked_at: new Date() })
        .where('id', '=', consentId)
        // Optimistic concurrency: refuse if the row moved since we read it.
        .where('version', '=', current.version)
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.audit.append(
        {
          actorId,
          actorRole: 'PATIENT',
          action: 'CONSENT_REVOKED',
          entityType: 'consent',
          entityId: consentId,
          correlationId,
        },
        trx,
      );

      return row;
    });
  }

  /**
   * Marks lapsed consents EXPIRED. Idempotent, so it is safe to run on a schedule.
   * Expiry is a state change with an audit trail, not an implicit property of a date.
   */
  async expireLapsed(executor: DbExecutor = this.db): Promise<number> {
    const result = await executor
      .updateTable('consent')
      .set({ state: 'EXPIRED' })
      .where('state', '=', 'GRANTED')
      .where('valid_until', '<=', sql<Date>`now()`)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }
}
