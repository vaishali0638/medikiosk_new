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

/** The banner a clinician sees over any generated draft. */
export const DOCTOR_FACING_DRAFT_LABEL =
  'AI-assisted pre-consultation draft — not verified' as const;

export * from './draft-safety';

export * from './languages';
