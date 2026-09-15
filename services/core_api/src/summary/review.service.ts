import { Injectable } from '@nestjs/common';
import { PROVENANCE_LABELS } from '@medikiosk/terminology';
import { NON_COMMITTAL_LABELS, type NonCommittalAnswer } from '@medikiosk/questionnaire-schema';
import { DomainError } from '../common/domain-error';
import { AnswerRepository } from '../intake/answer.repository';
import { QuestionnaireService } from '../intake/questionnaire.service';
import { PreCheckinService } from '../precheckin/precheckin.service';
import { DocumentService } from '../documents/document.service';
import type { ComposableAnswer, ComposableDocument, ComposeInput } from './deterministic-composer';
import type { GroundingMaterial } from './safety-validator';

const COMMON_CORE_KEY = 'common-core';

/** One row on the patient's review screen. */
export interface ReviewItem {
  readonly questionId: string;
  readonly prompt: string;
  readonly answered: boolean;
  /** What to show: the option labels, or the free text. Already in the patient's language. */
  readonly display: string | null;
  /** Null when the question was not answered: a non-answer has no source. */
  readonly provenance: string | null;
  readonly revision: number;
  /** Whether the patient may reopen this question from the review screen. */
  readonly editable: boolean;
}

export interface ReviewMaterial {
  readonly questionnaireKey: string;
  readonly questionnaireVersion: string;
  readonly ayushModuleVersion: string | null;
  readonly language: string;
  readonly items: readonly ReviewItem[];
  readonly documents: readonly ComposableDocument[];
  readonly answerRevisions: Record<string, number>;
  /** What the composer needs. */
  readonly composeInput: ComposeInput;
  /** What the validator checks a draft against. */
  readonly grounding: GroundingMaterial;
}

/**
 * Assembles everything the review screen, the composer and the validator need, once.
 *
 * They share a source deliberately. If the grounding material were gathered separately
 * from the answers the composer sees, the two could drift, and a validator checking a
 * draft against a different set of answers than it was built from would pass exactly the
 * fabrications it exists to catch.
 */
@Injectable()
export class ReviewService {
  constructor(
    private readonly questionnaires: QuestionnaireService,
    private readonly answers: AnswerRepository,
    private readonly preCheckins: PreCheckinService,
    private readonly documents: DocumentService,
  ) {}

  async gather(
    preCheckinId: string,
    language: string,
    correlationId: string,
  ): Promise<ReviewMaterial> {
    const preCheckin = await this.preCheckins.findById(preCheckinId);
    if (!preCheckin) {
      throw new DomainError('VALIDATION_FAILED', correlationId, 'unknown pre-check-in');
    }

    const ayushSystem = await this.questionnaires.systemForDepartment(preCheckin.department_id);
    const composed = await this.questionnaires.findComposed(
      preCheckin.hospital_id,
      COMMON_CORE_KEY,
      language,
      ayushSystem,
    );
    if (!composed) {
      throw new DomainError(
        'VALIDATION_FAILED',
        correlationId,
        `no published questionnaire for ${language}`,
      );
    }

    const lookup = await this.answers.lookup(preCheckinId);
    const answered = await this.answers.answeredQuestionIds(preCheckinId);
    const stored = await this.answers.latest(preCheckinId);
    const byId = new Map(stored.map((a) => [a.questionId, a]));

    // Ordered by the questionnaire, not by when the patient answered: the review screen
    // should read like the interview, not like a log.
    const questions = this.questionnaires.applicable(composed.questionnaire, lookup, answered);

    const items: ReviewItem[] = [];
    const composable: ComposableAnswer[] = [];
    const answerRevisions: Record<string, number> = {};
    const answerTexts: string[] = [];

    for (const question of questions) {
      const answer = byId.get(question.id);
      // Non-committal answers are not in `question.options` — they are a separate,
      // always-available set — so looking them up there falls through to the raw id and
      // puts `NOT_SURE` in front of a clinician. They are resolved first.
      const optionLabels = (answer?.selectedOptionIds ?? []).map(
        (id) =>
          NON_COMMITTAL_LABELS[id as NonCommittalAnswer] ??
          question.options?.find((o) => o.id === id)?.label ??
          id,
      );
      const value = displayValue(answer?.value);
      const display = value ?? (optionLabels.length > 0 ? optionLabels.join(', ') : null);

      items.push({
        questionId: question.id,
        prompt: question.prompt,
        answered: answer !== undefined,
        display,
        // Null when unanswered. Labelling a question the patient never answered
        // "patient-reported" attributes something to them that they did not say, which is
        // the exact failure mode provenance labels exist to prevent.
        provenance:
          answer === undefined
            ? null
            : answer.source === 'PATIENT_SELECTED'
              ? PROVENANCE_LABELS.PATIENT_SELECTED
              : PROVENANCE_LABELS.PATIENT_REPORTED,
        revision: answer?.revision ?? 0,
        // Everything is editable from the review screen. The specification's Edit button
        // is not decorative: a patient who spots a wrong answer and cannot fix it will
        // either submit something they know is wrong or walk away.
        editable: true,
      });

      composable.push({
        questionId: question.id,
        prompt: question.prompt,
        optionLabels,
        value,
        source: answer?.source === 'PATIENT_SELECTED' ? 'PATIENT_SELECTED' : 'PATIENT_REPORTED',
        sectionKey: question.section,
        answered: answer !== undefined,
      });

      if (answer) answerRevisions[question.id] = answer.revision;

      // The grounding vocabulary includes the PROMPTS as well as the answers. A draft may
      // restate the question it is answering — "no answer provided" against a prompt — and
      // a prompt is text the patient was shown, not text a generator invented.
      answerTexts.push(question.prompt);
      answerTexts.push(...optionLabels);
      if (value) answerTexts.push(value);
    }

    const documentRows = await this.documents.listForPreCheckin(preCheckinId);
    const documents: ComposableDocument[] = documentRows
      .filter((row) => row.state === 'STORED')
      .map((row) => ({
        documentId: row.documentId,
        // The TYPE, never the filename. A filename is patient-supplied text that would
        // enter the grounding vocabulary and could carry anything at all into a draft.
        label: DOCUMENT_LABELS[row.documentType] ?? 'Document',
        extractionState: row.extractionState,
      }));

    return {
      questionnaireKey: composed.questionnaire.key,
      questionnaireVersion: composed.questionnaire.version,
      ayushModuleVersion: composed.moduleUsed,
      language,
      items,
      documents,
      answerRevisions,
      composeInput: { answers: composable, documents },
      grounding: { answerTexts, documentLabels: documents.map((d) => d.label) },
    };
  }
}

/**
 * Renders a stored answer value as text.
 *
 * Numbers matter here. A numeric-scale answer — severity 3 of 5 — is stored as a number,
 * and an earlier version of this only accepted strings. The effect was that the answer
 * appeared in neither the draft's sections nor its "not answered" list: the patient
 * answered, and the clinician saw nothing at all, which is worse than either outcome on
 * its own. Anything scalar is rendered; objects are not, because there is no honest way
 * to show one to a doctor.
 */
function displayValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim().length > 0 ? value : null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return null;
}

/** Fixed English labels for document types. Not patient text, so safe to ground on. */
const DOCUMENT_LABELS: Readonly<Record<string, string>> = {
  PRESCRIPTION: 'Prescription',
  LAB_REPORT: 'Lab report',
  DISCHARGE_SUMMARY: 'Discharge summary',
  RADIOLOGY_REPORT: 'Radiology report',
  REFERRAL: 'Referral',
  OTHER: 'Other document',
};
