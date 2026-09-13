import { Inject, Injectable } from '@nestjs/common';
import { PROVENANCE_LABELS } from '@medikiosk/terminology';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import type { ClinicalDraft } from '../summary/draft.contract';

/** The last visit a clinician actually confirmed. */
export interface VerifiedVisit {
  readonly encounterId: string;
  readonly preCheckinId: string | null;
  readonly departmentName: string;
  readonly verifiedAt: Date;
  readonly verifiedBy: string;
  /** The confirmed record, as the clinician left it. */
  readonly record: ClinicalDraft;
}

/**
 * Finds the baseline a follow-up is measured against.
 *
 * The specification's rule is one sentence — "use the last clinician-verified visit, not
 * the last AI draft" — and it is the whole reason this service exists rather than the
 * follow-up code simply reading the most recent summary.
 *
 * Three things make it true rather than intended:
 *
 *   1. The query requires `encounter.verified_at IS NOT NULL`. An encounter nobody signed
 *      off is not a baseline.
 *   2. It joins to the summary the clinician named in `verified_summary_id`, not to the
 *      newest summary for that visit. A draft generated after verification — a re-run, a
 *      newly enabled model — cannot displace what was actually confirmed.
 *   3. It re-checks the label. `clinical_summary_verified_label` (migration 0016) already
 *      refuses CLINICIAN-VERIFIED unless a clinician and a timestamp are recorded, so a
 *      draft physically cannot carry it; asserting it here means a future change that
 *      loosened the constraint would break this query rather than silently promote
 *      generated text into a patient's history.
 */
@Injectable()
export class VerifiedVisitService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async lastVerifiedFor(patientId: string): Promise<VerifiedVisit | null> {
    const row = await this.db
      .selectFrom('encounter')
      .innerJoin('clinical_summary', 'clinical_summary.id', 'encounter.verified_summary_id')
      .innerJoin('department', 'department.id', 'encounter.department_id')
      .select([
        'encounter.id as encounterId',
        'encounter.pre_checkin_id as preCheckinId',
        'encounter.verified_at as verifiedAt',
        'encounter.verified_by_user_id as verifiedBy',
        'department.name as departmentName',
        'clinical_summary.content as content',
      ])
      .where('encounter.patient_id', '=', patientId)
      .where('encounter.verified_at', 'is not', null)
      .where('clinical_summary.provenance_label', '=', PROVENANCE_LABELS.CLINICIAN_VERIFIED)
      .orderBy('encounter.verified_at', 'desc')
      .executeTakeFirst();

    if (!row || row.verifiedAt === null || row.verifiedBy === null) return null;

    return {
      encounterId: row.encounterId,
      preCheckinId: row.preCheckinId,
      departmentName: row.departmentName,
      verifiedAt: row.verifiedAt,
      verifiedBy: row.verifiedBy,
      record: row.content as ClinicalDraft,
    };
  }
}
