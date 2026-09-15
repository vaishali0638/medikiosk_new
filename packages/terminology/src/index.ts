/**
 * Provenance labels.
 *
 * Every piece of information shown to a clinician must carry one of these labels.
 * They are a clinical-safety control: an AI- or OCR-derived value must never be
 * presented as verified clinical truth.
 */
export const PROVENANCE_LABELS = {
  PATIENT_REPORTED: 'PATIENT-REPORTED',
  PATIENT_SELECTED: 'PATIENT-SELECTED',
  SOURCE_DOCUMENT: 'SOURCE-DOCUMENT',
  OCR_EXTRACTED: 'OCR-EXTRACTED — VERIFY',
  SYSTEM_DETECTED: 'SYSTEM-DETECTED — REVIEW',
  AI_ASSISTED_DRAFT: 'AI-ASSISTED DRAFT — NOT VERIFIED',
  CLINICIAN_VERIFIED: 'CLINICIAN-VERIFIED',
} as const;

export type ProvenanceKey = keyof typeof PROVENANCE_LABELS;
export type ProvenanceLabel = (typeof PROVENANCE_LABELS)[ProvenanceKey];

/** The banner a patient sees over their own intake summary. */
export const PATIENT_FACING_SUMMARY_LABEL = 'Your information for the doctor' as const;

/**
 * The banner a clinician sees over a draft a model produced.
 *
 * Kept as the name it has always had because it is referenced widely; see
 * `draftBannerFor`, which is what call sites should now use.
 */
export const DOCTOR_FACING_DRAFT_LABEL =
  'AI-assisted pre-consultation draft — not verified' as const;

/** The banner over a draft composed by rule from the patient's own answers. */
export const COMPOSED_DRAFT_LABEL =
  "Pre-consultation draft from the patient's own answers — not verified" as const;

/** What produced a draft. Mirrors the `clinical_summary.generator` check constraint. */
export type DraftGeneratorKind = 'DETERMINISTIC' | 'MODEL';

/**
 * The banner for a draft, given what actually produced it.
 *
 * The banner used to say "AI-assisted" over every draft, including the ones no model had
 * touched — which is the default, since no model ships. Two things were wrong with that.
 *
 * A clinician reading "AI-assisted" over content that is nothing but their patient's own
 * answers, quoted, is being invited to distrust the most reliable material in the record.
 * And when a model IS wired in, nothing on the screen changes, so the label carries no
 * information at either end.
 *
 * Both banners still end in "not verified", because neither has been.
 */
export function draftBannerFor(generator: DraftGeneratorKind): string {
  return generator === 'MODEL' ? DOCTOR_FACING_DRAFT_LABEL : COMPOSED_DRAFT_LABEL;
}

export * from './draft-safety';

export * from './languages';
