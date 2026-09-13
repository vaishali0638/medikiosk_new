import { z } from 'zod';
import { DRAFT_LIMITS, PROVENANCE_LABELS } from '@medikiosk/terminology';

/**
 * The shape a pre-consultation draft must have.
 *
 * A schema rather than a string, because "the model returned prose" gives a validator
 * nothing to check. Structure lets each statement carry its own provenance, lets the
 * grounding check run per statement, and makes a malformed generator response a parse
 * failure rather than something that renders anyway with a missing label.
 */

/** Provenance a STATEMENT may carry. Absent deliberately: CLINICIAN_VERIFIED. */
export const STATEMENT_PROVENANCE = [
  PROVENANCE_LABELS.PATIENT_REPORTED,
  PROVENANCE_LABELS.PATIENT_SELECTED,
  PROVENANCE_LABELS.SOURCE_DOCUMENT,
  PROVENANCE_LABELS.OCR_EXTRACTED,
  PROVENANCE_LABELS.SYSTEM_DETECTED,
] as const;

export const draftStatementSchema = z.object({
  text: z.string().min(1).max(DRAFT_LIMITS.maxStatementChars),
  /**
   * Required, with no default. A default would mean a generator that omits provenance
   * gets one assigned for it, which is precisely the moment an unlabelled claim becomes
   * a labelled one.
   */
  provenance: z.enum(STATEMENT_PROVENANCE),
  /** The question or document this statement restates. Used by the grounding check. */
  sourceRef: z.string().min(1).max(200),
});

export const draftSectionSchema = z.object({
  key: z.string().min(1).max(64),
  heading: z.string().min(1).max(120),
  statements: z.array(draftStatementSchema).max(DRAFT_LIMITS.maxStatementsPerSection),
});

export const clinicalDraftSchema = z.object({
  sections: z.array(draftSectionSchema).max(DRAFT_LIMITS.maxSections),
  /** The prose a clinician reads first. May be empty; must never be unlabelled. */
  narrative: z.string().max(DRAFT_LIMITS.maxNarrativeChars),
});

export type DraftStatement = z.infer<typeof draftStatementSchema>;
export type DraftSection = z.infer<typeof draftSectionSchema>;
export type ClinicalDraft = z.infer<typeof clinicalDraftSchema>;
