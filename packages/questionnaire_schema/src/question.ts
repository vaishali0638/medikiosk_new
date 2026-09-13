import { z } from 'zod';

/**
 * How a question is answered.
 *
 * Every type here can be completed by touch alone. Voice and document upload are
 * *additional* modalities on top, never the only way to answer anything — a patient who
 * cannot or will not speak must be able to finish the whole interview.
 */
export const QUESTION_TYPES = [
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'TEXT',
  'DURATION',
  'DATE',
  'NUMERIC_SCALE',
  'YES_NO',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/**
 * Answers a patient may always give, on every question.
 *
 * These are not opt-outs to be minimised. A kiosk that forces a choice gets a guess, and
 * a guess recorded as a clinical answer is worse than no answer at all — the doctor
 * cannot tell them apart. "Prefer to discuss with doctor" in particular is a legitimate
 * and complete answer, not a failure to answer.
 */
export const NON_COMMITTAL_ANSWERS = [
  'NOT_SURE',
  'PREFER_TO_DISCUSS_WITH_DOCTOR',
  'NOT_APPLICABLE',
] as const;
export type NonCommittalAnswer = (typeof NON_COMMITTAL_ANSWERS)[number];

export const optionSchema = z.object({
  /** Stable across translations and versions. What gets stored. */
  id: z.string().min(1).max(64),
  /** Display text, in the language this release was published for. */
  label: z.string().min(1),
  /** Optional icon name. Icons never appear without their label. */
  icon: z.string().max(64).optional(),
});

export const durationBandSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1),
});

/**
 * A question, as published.
 *
 * `sensitive` marks the topics the specification calls out — smoking, alcohol,
 * menstruation, family history, mental health. The kiosk shows a "why are we asking?"
 * explanation before them and makes declining as easy as answering.
 */
/**
 * Where an answer appears in the clinician's draft.
 *
 * Part of the authored questionnaire rather than something the composer infers from a
 * question id. A reviewer approving the content decides that "Are you taking any medicine"
 * belongs under current medicines; guessing it from a string in code would put the
 * decision somewhere no clinician ever reads.
 */
export const DRAFT_SECTIONS = [
  'REASON_FOR_VISIT',
  'DURATION_ONSET',
  'SEVERITY_IMPACT',
  'CURRENT_MEDICINES',
  'ALLERGIES',
  'PAST_HISTORY',
  'OTHER',
] as const;

export type DraftSectionKey = (typeof DRAFT_SECTIONS)[number];

export const questionSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(QUESTION_TYPES),
  /** Which section of the clinician's draft this answer belongs under. */
  section: z.enum(DRAFT_SECTIONS).default('OTHER'),
  /** The question as the patient reads it. */
  prompt: z.string().min(1),
  /** Optional plain-language help, shown alongside rather than behind a tap. */
  help: z.string().optional(),
  options: z.array(optionSchema).optional(),
  /** For NUMERIC_SCALE. */
  scale: z
    .object({
      min: z.number().int(),
      max: z.number().int(),
      minLabel: z.string(),
      maxLabel: z.string(),
    })
    .optional(),
  /** For TEXT. */
  maxLength: z.number().int().positive().max(2000).optional(),
  sensitive: z.boolean().default(false),
  /** Shown before a sensitive question, explaining why it is being asked. */
  sensitiveExplanation: z.string().optional(),
  /**
   * Which non-committal answers this question offers. Defaults to all three; a question
   * may narrow the list where one makes no sense, but may never offer none.
   */
  nonCommittal: z
    .array(z.enum(NON_COMMITTAL_ANSWERS))
    .min(1)
    .default([...NON_COMMITTAL_ANSWERS]),
});

export type Question = z.infer<typeof questionSchema>;
