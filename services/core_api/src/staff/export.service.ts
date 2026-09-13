import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EmrExportAdapter } from '@medikiosk/his-adapter';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import type { EncounterExportRow } from '../db/database.types';
import { DomainError } from '../common/domain-error';
import { AuditRepository } from '../audit/audit.repository';
import type { StaffContext } from './staff-auth.service';

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly emr: EmrExportAdapter,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Sends a confirmed record to the hospital's EMR.
   *
   * Two rules from the specification are load-bearing here. **Only a confirmed record is
   * exported** — the check is against `encounter.verified_at`, which cannot be set without
   * a named clinician and a CLINICIAN-VERIFIED summary. And the export is **idempotent**,
   * enforced in three places, because a duplicated clinical note is a second version of
   * the truth that someone has to reconcile by hand:
   *
   *   1. The idempotency key is derived from the encounter, never supplied.
   *   2. That column is UNIQUE, so concurrent calls collapse rather than race.
   *   3. A partial unique index refuses a second SENT or ACKNOWLEDGED row per encounter.
   *
   * An uncertain outcome does not retry blindly. It asks the EMR what it already has,
   * exactly as the token path does, and parks in RECONCILIATION_REQUIRED if it still
   * cannot tell.
   */
  async exportEncounter(input: {
    staff: StaffContext;
    encounterId: string;
    correlationId: string;
  }): Promise<{ state: EncounterExportRow['state']; hisRecordRef: string | null }> {
    const visit = await this.loadVerified(input.encounterId, input.correlationId);
    const key = `export-${input.encounterId}`;

    const existing = await this.db
      .selectFrom('encounter_export')
      .selectAll()
      .where('idempotency_key', '=', key)
      .executeTakeFirst();

    // Already landed. Return it without contacting the EMR at all.
    if (existing && (existing.state === 'SENT' || existing.state === 'ACKNOWLEDGED')) {
      return { state: existing.state, hisRecordRef: existing.his_record_ref };
    }

    const payload = JSON.stringify(visit.record);
    const payloadSha256 = createHash('sha256').update(payload).digest('hex');

    const row =
      existing ??
      (await this.db
        .insertInto('encounter_export')
        .values({
          encounter_id: input.encounterId,
          idempotency_key: key,
          state: 'PENDING',
          exported_by_user_id: input.staff.userId,
          payload_sha256: payloadSha256,
          correlation_id: input.correlationId,
        })
        .returningAll()
        .executeTakeFirstOrThrow());

    await this.db
      .updateTable('encounter_export')
      // `updated_at` and `version` are the trigger's business, not the application's.
      .set({ attempt_count: row.attempt_count + 1 })
      .where('id', '=', row.id)
      .execute();

    const result = await this.emr.exportRecord({
      idempotencyKey: key,
      hospitalCode: visit.hospitalCode,
      uhid: visit.uhid ?? undefined,
      encounterRef: visit.hisEncounterRef ?? undefined,
      departmentCode: visit.departmentCode,
      clinicianRef: visit.verifiedBy,
      verifiedAt: visit.verifiedAt.toISOString(),
      record: visit.record,
      correlationId: input.correlationId,
    });

    switch (result.outcome) {
      case 'ACCEPTED':
        return this.settle(row.id, 'ACKNOWLEDGED', result.hisRecordRef, null, input);

      case 'REJECTED':
        // A rejection is final for this attempt and safe: the EMR did not take it.
        this.logger.warn(
          `export rejected ${result.errorCode} correlationId=${input.correlationId}`,
        );
        return this.settle(row.id, 'FAILED', null, result.errorCode, input);

      case 'UNCERTAIN': {
        // Ask before retrying. The record may already be in the EMR.
        const status = await this.emr.getExportStatus(key, input.correlationId);
        if (status.outcome === 'ACCEPTED') {
          return this.settle(row.id, 'ACKNOWLEDGED', status.hisRecordRef, null, input);
        }
        // Still unknown. Parked for a human rather than resolved by guessing — the guess
        // that is wrong produces a duplicate clinical note.
        return this.settle(row.id, 'RECONCILIATION_REQUIRED', null, 'UNCERTAIN', input);
      }
    }
  }

  private async settle(
    exportId: string,
    state: EncounterExportRow['state'],
    hisRecordRef: string | null,
    errorCode: string | null,
    input: { staff: StaffContext; encounterId: string; correlationId: string },
  ): Promise<{ state: EncounterExportRow['state']; hisRecordRef: string | null }> {
    await this.db
      .updateTable('encounter_export')
      .set({
        state,
        his_record_ref: hisRecordRef,
        last_error_code: errorCode,
      })
      .where('id', '=', exportId)
      .execute();

    await this.audit.append({
      actorId: input.staff.userId,
      actorRole: input.staff.role,
      action: 'CLINICAL_RECORD_EXPORTED',
      entityType: 'encounter',
      entityId: input.encounterId,
      correlationId: input.correlationId,
      detail: { state, adapter: this.emr.kind, errorCode },
    });

    return { state, hisRecordRef };
  }

  /** Loads the encounter, refusing anything a clinician has not confirmed. */
  private async loadVerified(
    encounterId: string,
    correlationId: string,
  ): Promise<{
    hospitalCode: string;
    departmentCode: string;
    uhid: string | null;
    hisEncounterRef: string | null;
    verifiedBy: string;
    verifiedAt: Date;
    record: unknown;
  }> {
    const row = await this.db
      .selectFrom('encounter')
      .innerJoin('department', 'department.id', 'encounter.department_id')
      .innerJoin('branch', 'branch.id', 'department.branch_id')
      .innerJoin('hospital', 'hospital.id', 'branch.hospital_id')
      .leftJoin('clinical_summary', 'clinical_summary.id', 'encounter.verified_summary_id')
      .leftJoin('patient_identifier', (join) =>
        join
          .onRef('patient_identifier.patient_id', '=', 'encounter.patient_id')
          .on('patient_identifier.type', '=', 'UHID'),
      )
      .select([
        'hospital.code as hospitalCode',
        'department.code as departmentCode',
        'patient_identifier.value as uhid',
        'encounter.his_encounter_ref as hisEncounterRef',
        'encounter.verified_at as verifiedAt',
        'encounter.verified_by_user_id as verifiedBy',
        'clinical_summary.content as record',
      ])
      .where('encounter.id', '=', encounterId)
      .executeTakeFirst();

    if (!row) {
      throw new DomainError('NOT_AUTHORISED', correlationId, 'unknown encounter');
    }

    // The rule the whole phase turns on: an unconfirmed record is not exportable. Not a
    // UI affordance to be greyed out, a refusal here.
    if (row.verifiedAt === null || row.verifiedBy === null || row.record === null) {
      throw new DomainError(
        'VALIDATION_FAILED',
        correlationId,
        'record has not been confirmed by a clinician',
      );
    }

    return {
      hospitalCode: row.hospitalCode,
      departmentCode: row.departmentCode,
      uhid: row.uhid,
      hisEncounterRef: row.hisEncounterRef,
      verifiedBy: row.verifiedBy,
      verifiedAt: row.verifiedAt,
      record: row.record,
    };
  }
}
