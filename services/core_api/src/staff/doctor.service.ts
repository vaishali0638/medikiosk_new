import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PROVENANCE_LABELS } from '@medikiosk/terminology';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import { withSerializableRetry } from '../db/transaction';
import { DomainError } from '../common/domain-error';
import { AuditRepository } from '../audit/audit.repository';
import { clinicalDraftSchema, type ClinicalDraft } from '../summary/draft.contract';
import type { StaffContext } from './staff-auth.service';

export interface WorklistEntry {
  readonly encounterId: string;
  readonly token: string | null;
  readonly maskedName: string;
  readonly departmentName: string;
  readonly tokenIssuedAt: Date | null;
  readonly verified: boolean;
  readonly hasDraft: boolean;
  readonly documentCount: number;
}

@Injectable()
export class DoctorService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Today's patients for this clinician.
   *
   * Scoped to their department and their hospital in the query itself, not filtered after
   * loading. A worklist that fetched the hospital and then narrowed it in code would send
   * every patient in the building to the browser, where the narrowing is a suggestion.
   *
   * Names are masked here too. The worklist is a screen in a shared consulting room and is
   * often on a second monitor; the full name is on the record the clinician then opens.
   */
  async worklist(staff: StaffContext, search?: string): Promise<WorklistEntry[]> {
    let query = this.db
      .selectFrom('encounter')
      .innerJoin('department', 'department.id', 'encounter.department_id')
      .innerJoin('branch', 'branch.id', 'department.branch_id')
      .innerJoin('patient', 'patient.id', 'encounter.patient_id')
      .leftJoin('patient_identifier', (join) =>
        join
          .onRef('patient_identifier.patient_id', '=', 'patient.id')
          .on('patient_identifier.type', '=', 'UHID'),
      )
      .select([
        'encounter.id as encounterId',
        'encounter.his_token as token',
        'encounter.token_issued_at as tokenIssuedAt',
        'encounter.verified_at as verifiedAt',
        'encounter.pre_checkin_id as preCheckinId',
        'patient.full_name as fullName',
        'patient_identifier.value as uhid',
        'department.name as departmentName',
      ])
      .where('branch.hospital_id', '=', staff.hospitalId)
      .orderBy('encounter.token_issued_at', 'asc');

    if (staff.departmentId !== null) {
      query = query.where('encounter.department_id', '=', staff.departmentId);
    }

    if (search && search.trim().length > 0) {
      const term = search.trim();
      // Token or UHID only. Searching by name would make the worklist a way to look up
      // whether a particular person attended, which is precisely what the department
      // scoping above exists to prevent.
      query = query.where((eb) =>
        eb.or([eb('encounter.his_token', '=', term), eb('patient_identifier.value', '=', term)]),
      );
    }

    const rows = await query.execute();

    const entries: WorklistEntry[] = [];
    for (const row of rows) {
      const counts = await this.countsFor(row.preCheckinId);
      entries.push({
        encounterId: row.encounterId,
        token: row.token,
        maskedName: maskName(row.fullName),
        departmentName: row.departmentName,
        tokenIssuedAt: row.tokenIssuedAt,
        verified: row.verifiedAt !== null,
        hasDraft: counts.hasDraft,
        documentCount: counts.documents,
      });
    }
    return entries;
  }

  private async countsFor(
    preCheckinId: string | null,
  ): Promise<{ hasDraft: boolean; documents: number }> {
    if (!preCheckinId) return { hasDraft: false, documents: 0 };

    const draft = await this.db
      .selectFrom('clinical_summary')
      .select('id')
      .where('pre_checkin_id', '=', preCheckinId)
      .where('validation_state', '=', 'ACCEPTED')
      .executeTakeFirst();

    const documents = await this.db
      .selectFrom('document')
      .select('id')
      .where('pre_checkin_id', '=', preCheckinId)
      .where('state', '=', 'STORED')
      .execute();

    return { hasDraft: draft !== undefined, documents: documents.length };
  }

  /**
   * Confirms the record, which is the act this whole system defers to.
   *
   * A new `clinical_summary` row is written rather than the draft being updated in place.
   * The draft is what a generator produced and the confirmed record is what a clinician
   * signed; overwriting the first with the second would destroy the evidence of what they
   * were shown when they signed, which is the only way to answer "what did the doctor
   * actually see" after a disagreement.
   *
   * Both rows and the encounter's verification are written in one transaction: a verified
   * encounter pointing at a summary that does not exist, or a CLINICIAN-VERIFIED summary
   * no encounter references, are both worse than neither.
   */
  async confirm(input: {
    staff: StaffContext;
    encounterId: string;
    preCheckinId: string | null;
    /** The record as the clinician left it, corrections included. */
    record: unknown;
    correlationId: string;
  }): Promise<{ summaryId: string; verifiedAt: Date }> {
    if (!input.preCheckinId) {
      throw new DomainError('VALIDATION_FAILED', input.correlationId, 'encounter has no visit');
    }

    const parsed = clinicalDraftSchema.safeParse(input.record);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', input.correlationId, 'malformed record');
    }
    const record: ClinicalDraft = parsed.data;

    return withSerializableRetry(this.db, async (trx) => {
      const encounter = await trx
        .selectFrom('encounter')
        .selectAll()
        .where('id', '=', input.encounterId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      // Already confirmed: return what is there. Re-confirming would replace one
      // clinician's signature with another's without anyone asking for that.
      if (encounter.verified_at !== null && encounter.verified_summary_id !== null) {
        return { summaryId: encounter.verified_summary_id, verifiedAt: encounter.verified_at };
      }

      const verifiedAt = new Date();
      const summary = await trx
        .insertInto('clinical_summary')
        .values({
          pre_checkin_id: input.preCheckinId as string,
          // Not DETERMINISTIC or MODEL: a person wrote this one.
          generator: 'DETERMINISTIC',
          generator_version: `clinician:${input.staff.userId}`,
          content: JSON.stringify(record),
          validation_state: 'ACCEPTED',
          rejection_reasons: JSON.stringify([]),
          provenance_label: PROVENANCE_LABELS.CLINICIAN_VERIFIED,
          verified_by_user_id: input.staff.userId,
          verified_at: verifiedAt,
          correlation_id: input.correlationId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('encounter')
        .set({
          verified_at: verifiedAt,
          verified_by_user_id: input.staff.userId,
          verified_summary_id: summary.id,
        })
        .where('id', '=', input.encounterId)
        .execute();

      await this.audit.append(
        {
          actorId: input.staff.userId,
          actorRole: input.staff.role,
          action: 'CLINICAL_RECORD_CONFIRMED',
          entityType: 'encounter',
          entityId: input.encounterId,
          correlationId: input.correlationId,
          detail: {
            summaryId: summary.id,
            sections: record.sections.length,
            // Whether the clinician changed anything before signing. A record confirmed
            // unchanged and one heavily corrected are different events at review.
            contentSha256: createHash('sha256')
              .update(JSON.stringify(record))
              .digest('hex')
              .slice(0, 16),
          },
        },
        trx,
      );

      return { summaryId: summary.id, verifiedAt };
    });
  }
}

/** `Ravi Kumar` -> `R**** K****`. */
function maskName(name: string | null): string {
  if (!name) return '';
  return name
    .split(/\s+/)
    .map((part) => (part.length <= 1 ? part : `${part[0]}${'*'.repeat(part.length - 1)}`))
    .join(' ');
}
