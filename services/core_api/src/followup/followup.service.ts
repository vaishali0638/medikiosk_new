import { Inject, Injectable } from '@nestjs/common';
import { PROVENANCE_LABELS } from '@medikiosk/terminology';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import { withSerializableRetry } from '../db/transaction';
import { DomainError } from '../common/domain-error';
import { AuditRepository } from '../audit/audit.repository';
import { AnswerRepository } from '../intake/answer.repository';
import { VerifiedVisitService, type VerifiedVisit } from './verified-visit.service';

/** The eight questions of master prompt §19, as sections a patient can declare against. */
export const FOLLOW_UP_SECTIONS = [
  'SYMPTOMS',
  'NEW_SYMPTOM',
  'MEDICINES',
  'ALLERGY_OR_SIDE_EFFECT',
  'NEW_REPORT',
  'NEW_DIAGNOSIS_ELSEWHERE',
  'QUESTIONS_FOR_DOCTOR',
] as const;

export type FollowUpSection = (typeof FOLLOW_UP_SECTIONS)[number];

/** One thing the patient says has changed. */
export interface DeclaredChange {
  readonly section: FollowUpSection;
  /** The patient's own words. Optional: "something changed" is itself information. */
  readonly detail?: string | undefined;
}

export interface DeltaItem {
  readonly kind: string;
  readonly label: string;
  /** What this item is about: a question id, a document id, or a section name. Its
   *  identity — the rendered label is not unique. */
  readonly ref: string;
  readonly changeKind: 'UNCHANGED' | 'CHANGED' | 'NOT_CONFIRMED';
  readonly detail: Record<string, unknown>;
  readonly source: string;
}

export interface FollowUpDelta {
  readonly previousVerifiedAt: Date;
  readonly previousDepartment: string;
  readonly unchanged: readonly DeltaItem[];
  readonly changed: readonly DeltaItem[];
  readonly notConfirmed: readonly DeltaItem[];
}

@Injectable()
export class FollowUpService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly verified: VerifiedVisitService,
    private readonly answers: AnswerRepository,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Records what changed since the last verified visit.
   *
   * The delta is assembled from three sources, and keeping them apart is the point of the
   * exercise. A doctor reading a follow-up needs to know which of the things in front of
   * them was carried forward from a record they already signed, which the patient has
   * just told them, and which nobody has established at all.
   *
   * Carried-forward items are written as UNCHANGED rather than omitted. A follow-up that
   * listed only changes would leave the doctor unable to tell "the hypertension is stable"
   * from "nobody asked about the hypertension", and those call for different consultations.
   */
  async record(input: {
    preCheckinId: string;
    patientId: string;
    changes: readonly DeclaredChange[];
    correlationId: string;
    actorId: string;
  }): Promise<{ baseline: VerifiedVisit; itemCount: number }> {
    const baseline = await this.verified.lastVerifiedFor(input.patientId);
    if (!baseline) {
      // Not an error the patient sees as a failure — it means this is not a follow-up.
      // The caller falls back to a full intake, which is the correct thing to collect
      // when there is no verified history to measure against.
      throw new DomainError(
        'VALIDATION_FAILED',
        input.correlationId,
        'no clinician-verified visit to follow up on',
      );
    }

    const declared = new Map(input.changes.map((c) => [c.section, c]));
    const items: DeltaItem[] = [];

    // 1. What the previous clinician confirmed, unless the patient has just contradicted
    //    it. The baseline's own statements are reused verbatim: a follow-up must not
    //    paraphrase a record a clinician signed.
    for (const section of baseline.record.sections) {
      const touched = SECTION_FOR_BASELINE[section.key];
      const change = touched ? declared.get(touched) : undefined;

      for (const statement of section.statements) {
        items.push({
          kind: section.key,
          label: statement.text,
          // The statement's own source reference, so two questions that happen to produce
          // the same sentence — "Patient reported: 'I am not sure'" is extremely common —
          // stay distinct items.
          ref: `baseline:${section.key}:${statement.sourceRef}`,
          changeKind: change ? 'CHANGED' : 'UNCHANGED',
          detail: change?.detail !== undefined ? { patientSaid: change.detail } : {},
          // Carried forward from a verified record, so it keeps that provenance rather
          // than being relabelled as something the patient reported today.
          source: change ? 'PATIENT_REPORTED' : 'CLINICIAN_VERIFIED',
        });
      }
    }

    // 2. What the patient declared that has no counterpart in the baseline — a new
    //    symptom, a new report. These have nothing to be "changed" from.
    for (const change of input.changes) {
      if (BASELINE_FOR_SECTION[change.section] !== undefined) continue;
      items.push({
        kind: change.section,
        label: SECTION_LABELS[change.section],
        ref: `declared:${change.section}`,
        changeKind: 'CHANGED',
        detail: change.detail !== undefined ? { patientSaid: change.detail } : {},
        source: 'PATIENT_REPORTED',
      });
    }

    // 3. What nobody has established. Non-committal answers and unreviewed extractions
    //    both belong here, and the specification wants them prominent: "prescription dose
    //    unclear" is a thing the doctor must resolve in the room, not a gap to scroll past.
    items.push(...(await this.notConfirmedItems(input.preCheckinId)));

    await withSerializableRetry(this.db, async (trx) => {
      await trx
        .deleteFrom('follow_up_delta')
        .where('pre_checkin_id', '=', input.preCheckinId)
        .execute();

      if (items.length > 0) {
        await trx
          .insertInto('follow_up_delta')
          .values(
            items.map((item) => ({
              pre_checkin_id: input.preCheckinId,
              previous_encounter_id: baseline.encounterId,
              previous_verified_at: baseline.verifiedAt,
              item_kind: item.kind,
              item_label: item.label.slice(0, 500),
              item_ref: item.ref,
              change_kind: item.changeKind,
              detail: JSON.stringify(item.detail) as never,
              source: item.source as never,
            })),
          )
          .execute();
      }

      await this.audit.append(
        {
          actorId: input.actorId,
          actorRole: 'kiosk',
          action: 'FOLLOW_UP_DELTA_RECORDED',
          entityType: 'pre_checkin',
          entityId: input.preCheckinId,
          correlationId: input.correlationId,
          detail: {
            baselineEncounterId: baseline.encounterId,
            // Counts only. What changed is clinical content and lives in the rows.
            unchanged: items.filter((i) => i.changeKind === 'UNCHANGED').length,
            changed: items.filter((i) => i.changeKind === 'CHANGED').length,
            notConfirmed: items.filter((i) => i.changeKind === 'NOT_CONFIRMED').length,
          },
        },
        trx,
      );
    });

    return { baseline, itemCount: items.length };
  }

  /**
   * Everything the visit has not established.
   *
   * Two kinds. A patient who answered "I am not sure" or "I prefer to tell the doctor" has
   * given a real answer, and it is not a value — recording it as one would invent
   * information. And a document whose extraction is still awaiting review is exactly the
   * specification's "prescription dose unclear".
   */
  private async notConfirmedItems(preCheckinId: string): Promise<DeltaItem[]> {
    const items: DeltaItem[] = [];

    // The LATEST revision of each answer, not every revision. A patient who answered
    // "I am not sure" and then corrected it on the review screen has confirmed it; showing
    // the superseded answer would put a resolved uncertainty in front of the doctor.
    for (const answer of await this.answers.latest(preCheckinId)) {
      const nonCommittal = answer.selectedOptionIds.find((id) => NON_COMMITTAL.has(id));
      if (!nonCommittal) continue;

      items.push({
        kind: 'QUESTION',
        label: answer.questionId,
        ref: `question:${answer.questionId}`,
        changeKind: 'NOT_CONFIRMED',
        detail: { answer: nonCommittal },
        source: 'PATIENT_REPORTED',
      });
    }

    const extractions = await this.db
      .selectFrom('ocr_extraction')
      .innerJoin('document', 'document.id', 'ocr_extraction.document_id')
      .select([
        'document.id as documentId',
        'document.document_type as documentType',
        'ocr_extraction.review_state as state',
      ])
      .where('document.pre_checkin_id', '=', preCheckinId)
      .where('ocr_extraction.review_state', '=', 'AWAITING_CLINICIAN_REVIEW')
      .execute();

    for (const extraction of extractions) {
      items.push({
        kind: 'DOCUMENT',
        label: extraction.documentType,
        ref: `document:${extraction.documentId}`,
        changeKind: 'NOT_CONFIRMED',
        detail: { reason: 'AWAITING_CLINICIAN_REVIEW' },
        source: 'OCR_EXTRACTED',
      });
    }

    return items;
  }

  /** The delta as a clinician reads it: three groups, never one merged list. */
  async deltaFor(preCheckinId: string): Promise<FollowUpDelta | null> {
    const rows = await this.db
      .selectFrom('follow_up_delta')
      .innerJoin('encounter', 'encounter.id', 'follow_up_delta.previous_encounter_id')
      .innerJoin('department', 'department.id', 'encounter.department_id')
      .select([
        'follow_up_delta.item_kind as kind',
        'follow_up_delta.item_label as label',
        'follow_up_delta.item_ref as ref',
        'follow_up_delta.change_kind as changeKind',
        'follow_up_delta.detail as detail',
        'follow_up_delta.source as source',
        'follow_up_delta.previous_verified_at as previousVerifiedAt',
        'department.name as departmentName',
      ])
      .where('follow_up_delta.pre_checkin_id', '=', preCheckinId)
      .orderBy('follow_up_delta.created_at', 'asc')
      .execute();

    const first = rows[0];
    if (!first) return null;

    const asItem = (row: (typeof rows)[number]): DeltaItem => ({
      kind: row.kind,
      label: row.label,
      ref: row.ref ?? '',
      changeKind: row.changeKind,
      detail: (row.detail ?? {}) as Record<string, unknown>,
      source: row.source,
    });

    return {
      previousVerifiedAt: first.previousVerifiedAt,
      previousDepartment: first.departmentName,
      unchanged: rows.filter((r) => r.changeKind === 'UNCHANGED').map(asItem),
      changed: rows.filter((r) => r.changeKind === 'CHANGED').map(asItem),
      notConfirmed: rows.filter((r) => r.changeKind === 'NOT_CONFIRMED').map(asItem),
    };
  }
}

const NON_COMMITTAL = new Set<string>([
  'NOT_SURE',
  'PREFER_TO_DISCUSS_WITH_DOCTOR',
  'NOT_APPLICABLE',
]);

/** Which follow-up question can contradict which section of a verified record. */
const SECTION_FOR_BASELINE: Readonly<Record<string, FollowUpSection | undefined>> = {
  REASON_FOR_VISIT: 'SYMPTOMS',
  SEVERITY_IMPACT: 'SYMPTOMS',
  CURRENT_MEDICINES: 'MEDICINES',
  ALLERGIES: 'ALLERGY_OR_SIDE_EFFECT',
};

/** The inverse, for deciding which declarations have no baseline counterpart. */
const BASELINE_FOR_SECTION: Readonly<Partial<Record<FollowUpSection, string>>> = {
  SYMPTOMS: 'REASON_FOR_VISIT',
  MEDICINES: 'CURRENT_MEDICINES',
  ALLERGY_OR_SIDE_EFFECT: 'ALLERGIES',
};

const SECTION_LABELS: Readonly<Record<FollowUpSection, string>> = {
  SYMPTOMS: 'Symptoms',
  NEW_SYMPTOM: 'New symptom',
  MEDICINES: 'Medicines',
  ALLERGY_OR_SIDE_EFFECT: 'Allergy or side effect',
  NEW_REPORT: 'New report',
  NEW_DIAGNOSIS_ELSEWHERE: 'New diagnosis or treatment elsewhere',
  QUESTIONS_FOR_DOCTOR: 'Questions for the doctor',
};

/** Unused today, kept because the label map must stay exhaustive. */
export const FOLLOW_UP_SECTION_LABELS = SECTION_LABELS;
export { PROVENANCE_LABELS };
