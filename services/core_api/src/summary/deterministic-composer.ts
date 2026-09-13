import { NO_DIAGNOSIS_STATEMENT, PROVENANCE_LABELS } from '@medikiosk/terminology';
import type { ClinicalDraft, DraftSection, DraftStatement } from './draft.contract';

/**
 * Builds a draft from structured answers by rule. No model is involved.
 *
 * This is not a stand-in for the real thing. It is the FALLBACK the exit criteria require
 * ("AI unavailable falls back to structured touch workflow") and, with `FEATURE_AI_SUMMARY`
 * off, it is what every clinician actually reads. It is also the reference output the
 * safety validator is tested against.
 *
 * It cannot fabricate, because it has nothing to fabricate with: every word it emits is
 * either a section heading, a fixed connective, or a quoted answer.
 */

/** One answer as the composer needs it. */
export interface ComposableAnswer {
  readonly questionId: string;
  readonly prompt: string;
  /** Labels of the options the patient chose, already in their language. */
  readonly optionLabels: readonly string[];
  /** Free text the patient spoke or typed, if any. */
  readonly value: string | null;
  readonly source: 'PATIENT_REPORTED' | 'PATIENT_SELECTED' | 'SYSTEM_DETECTED';
  /** Which draft section this question belongs under. */
  readonly sectionKey: string;
  readonly answered: boolean;
}

export interface ComposableDocument {
  readonly documentId: string;
  /** The document type label, e.g. "Lab report". Never the filename. */
  readonly label: string;
  readonly extractionState: string | null;
}

export interface ComposeInput {
  readonly answers: readonly ComposableAnswer[];
  readonly documents: readonly ComposableDocument[];
}

/** Section order and headings. Fixed, so two visits read the same way. */
const SECTION_HEADINGS: ReadonlyMap<string, string> = new Map([
  ['REASON_FOR_VISIT', 'Reason for visit'],
  ['DURATION_ONSET', 'Duration and onset'],
  ['SEVERITY_IMPACT', 'Severity and impact'],
  ['CURRENT_MEDICINES', 'Current medicines'],
  ['ALLERGIES', 'Allergies'],
  ['PAST_HISTORY', 'Past history'],
  ['OTHER', 'Other information'],
  ['DOCUMENTS', 'Documents'],
  ['NOT_ANSWERED', 'Not answered'],
]);

export const COMPOSER_VERSION = '1.0.0' as const;

function statementFor(answer: ComposableAnswer): DraftStatement | null {
  if (!answer.answered) return null;

  // Selected options are the patient's words as printed on the button they pressed, so
  // they are quoted too. The doctor can then see the difference between an option the
  // kiosk offered and something the patient volunteered — by the label, not the wording.
  const chosen = answer.optionLabels.length > 0 ? answer.optionLabels.join(', ') : null;
  const spoken = answer.value?.trim() ?? '';
  const body = spoken.length > 0 ? spoken : chosen;
  if (body === null || body.length === 0) return null;

  return {
    text: `Patient reported: "${body}"`,
    provenance:
      answer.source === 'PATIENT_SELECTED'
        ? PROVENANCE_LABELS.PATIENT_SELECTED
        : answer.source === 'SYSTEM_DETECTED'
          ? PROVENANCE_LABELS.SYSTEM_DETECTED
          : PROVENANCE_LABELS.PATIENT_REPORTED,
    sourceRef: answer.questionId,
  };
}

function documentStatement(document: ComposableDocument): DraftStatement {
  // A document that has been read by OCR is labelled for verification; one that has not
  // is a source document the clinician will open. Neither carries extracted content here:
  // the extraction is a separate, individually labelled surface.
  const awaiting = document.extractionState === 'AWAITING_CLINICIAN_REVIEW';
  return {
    text: awaiting
      ? `"${document.label}" uploaded, awaiting review`
      : `"${document.label}" uploaded`,
    provenance: awaiting ? PROVENANCE_LABELS.OCR_EXTRACTED : PROVENANCE_LABELS.SOURCE_DOCUMENT,
    sourceRef: document.documentId,
  };
}

export function compose(input: ComposeInput): ClinicalDraft {
  const sections: DraftSection[] = [];

  for (const [key, heading] of SECTION_HEADINGS) {
    if (key === 'DOCUMENTS' || key === 'NOT_ANSWERED') continue;

    const statements = input.answers
      .filter((a) => a.sectionKey === key)
      .map(statementFor)
      .filter((s): s is DraftStatement => s !== null);

    if (statements.length > 0) sections.push({ key, heading, statements });
  }

  if (input.documents.length > 0) {
    sections.push({
      key: 'DOCUMENTS',
      heading: SECTION_HEADINGS.get('DOCUMENTS') ?? 'Documents',
      statements: input.documents.map(documentStatement),
    });
  }

  // What the patient did NOT answer is clinical information too. A doctor who cannot see
  // that the allergy question was skipped will assume it was answered "no", and that
  // assumption is the kind that causes harm. So unanswered questions are a section, not
  // an omission.
  const unanswered = input.answers.filter((a) => !a.answered);
  if (unanswered.length > 0) {
    sections.push({
      key: 'NOT_ANSWERED',
      heading: SECTION_HEADINGS.get('NOT_ANSWERED') ?? 'Not answered',
      statements: unanswered.slice(0, 10).map((a) => ({
        text: `"${a.prompt}" — no answer provided`,
        provenance: PROVENANCE_LABELS.SYSTEM_DETECTED,
        sourceRef: a.questionId,
      })),
    });
  }

  return { sections, narrative: narrativeFor(input) };
}

function narrativeFor(input: ComposeInput): string {
  const lines: string[] = [];

  const reason = reasonForVisit(input);
  if (reason !== null) {
    // Repeated at the top because it is the one thing a clinician reads before deciding
    // how much of the rest to read.
    lines.push(`Patient reports "${reason}"`);
  }

  // Deliberately no counts. "Answered 3 of 21 questions" would put a number in the
  // narrative that the patient never said, and the validator refuses ungrounded numbers
  // for good reason — a fabricated number in a clinical draft is a dose or a duration
  // waiting to happen. The exact counts are in the structured sections, where a reader
  // can see what they refer to.
  if (input.answers.some((a) => !a.answered)) {
    lines.push('Some questions were not answered');
  }
  if (input.documents.length > 0) {
    lines.push('Previous documents were uploaded');
  }

  // Always last, always present. The validator refuses a draft without it.
  return `${lines.join('. ')}. ${NO_DIAGNOSIS_STATEMENT}`;
}

/**
 * The opening line: what the patient said they came about.
 *
 * Free text wins over a selected option. A patient who picks "Something else" and then
 * describes knee pain has told the doctor two things, and only one of them is worth the
 * first line — "Patient reports 'Something else'" is what an early version of this
 * produced, and it is worse than no opening line at all.
 */
function reasonForVisit(input: ComposeInput): string | null {
  const reasons = input.answers.filter((a) => a.sectionKey === 'REASON_FOR_VISIT' && a.answered);

  const described = reasons.find((a) => (a.value?.trim().length ?? 0) > 0);
  if (described?.value) return described.value.trim();

  const selected = reasons.find((a) => a.optionLabels.length > 0);
  return selected ? selected.optionLabels.join(', ') : null;
}
