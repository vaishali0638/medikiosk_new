/**
 * The language a pre-consultation draft is not allowed to use.
 *
 * MediKiosk documents what a patient said. It does not reason about it. The distance
 * between those two is entirely a matter of wording — "patient reports knee pain for two
 * months" and "patient likely has osteoarthritis" can be produced from exactly the same
 * input — so the wording is checked, mechanically, before any draft reaches a clinician.
 *
 * These lists live in the terminology package rather than inside the generator because
 * every surface that renders a draft needs the same definition of unsafe, and because a
 * rule that is easy to find is a rule a reviewer can argue with.
 */

/** A pattern the validator refuses, with the reason a reviewer will see. */
export interface BannedPattern {
  readonly code: string;
  readonly pattern: RegExp;
  readonly why: string;
}

/**
 * Diagnostic and inferential language.
 *
 * The specification's example is `Diagnosis: Arthritis`, but a bare heading is the easy
 * case. What actually reaches a clinician is hedged inference — "suggestive of",
 * "consistent with", "cannot rule out" — which reads as clinical reasoning, carries the
 * authority of the system that printed it, and is not something an intake kiosk is
 * entitled to.
 */
export const DIAGNOSTIC_PATTERNS: readonly BannedPattern[] = [
  {
    code: 'DIAGNOSIS_HEADING',
    pattern: /\b(diagnosis|impression|assessment|differential)\s*:/i,
    why: 'A diagnosis heading presents intake data as a clinical conclusion.',
  },
  {
    code: 'INFERENTIAL_PHRASE',
    pattern:
      /\b(suggestive of|consistent with|indicative of|points? to|in keeping with|compatible with)\b/i,
    why: 'Inferential phrasing is clinical reasoning, which the kiosk does not perform.',
  },
  {
    code: 'PROBABILITY_CLAIM',
    pattern: /\b(likely|probably|probable|presumed|presumptive|most likely|appears to be)\b/i,
    why: 'A likelihood claim is a diagnosis stated with a hedge.',
  },
  {
    code: 'RULE_OUT',
    pattern: /\b(rule out|ruled out|r\/o|exclude the possibility)\b/i,
    why: 'Ruling a condition in or out is a clinician’s act.',
  },
  {
    code: 'DIAGNOSED_AS',
    pattern: /\b(diagnosed (with|as)|is a case of|known case of|suffering from)\b/i,
    why: 'Asserts a diagnosis the patient may only have reported, or may not have at all.',
  },
];

/**
 * Treatment advice.
 *
 * Note what is NOT banned here: a dose. "Patient reports taking Metformin 500 mg" is a
 * patient-reported fact and one of the more clinically useful things in an intake. What
 * is banned is the recommending voice — the difference between recording a medicine and
 * advising one.
 */
export const TREATMENT_PATTERNS: readonly BannedPattern[] = [
  {
    code: 'RECOMMENDATION',
    pattern:
      /\b(recommend|recommended|advise|advised|prescrib\w+|suggest (that )?(the )?patient)\b/i,
    why: 'The kiosk does not prescribe or advise treatment.',
  },
  {
    code: 'INSTRUCTION',
    pattern:
      /\b(should (take|start|stop|continue|avoid)|must (take|start|stop|avoid)|needs? to take)\b/i,
    why: 'An instruction to the patient is treatment advice.',
  },
  {
    code: 'REMEDY_SELECTION',
    pattern: /\b(remedy|formulation|dosage regimen|treatment plan|therapy plan)\b/i,
    why: 'Selecting an AYUSH remedy or a plan is a practitioner’s decision.',
  },
];

/**
 * Urgency.
 *
 * Red-flag handling is internal by design (master prompt §16): the kiosk has no urgent-help
 * button, and a draft that shouts "urgent" is that button by another route. It also makes a
 * promise the hospital may have no workflow to keep.
 */
export const URGENCY_PATTERNS: readonly BannedPattern[] = [
  {
    code: 'URGENCY_CLAIM',
    pattern:
      /\b(urgent|urgently|emergency|emergent|immediately|critical|life-threatening|severe risk)\b/i,
    why: 'Urgency claims belong to the internal red-flag workflow, not to a draft.',
  },
];

export const BANNED_PATTERNS: readonly BannedPattern[] = [
  ...DIAGNOSTIC_PATTERNS,
  ...TREATMENT_PATTERNS,
  ...URGENCY_PATTERNS,
];

/**
 * The only words a draft may contain that are not traceable to the patient's own answers.
 *
 * This is the anti-fabrication control, and it is deliberately an allowlist. A blocklist of
 * disease names cannot work: there are tens of thousands of them, in several languages,
 * and a generator that invents one not on the list passes. Requiring instead that every
 * content word be either scaffolding from this list or a word the patient actually used
 * means an invented condition fails regardless of what it is called.
 *
 * Every addition to this list widens what a generator may say unsupported, so each one
 * should be a word that carries no clinical content on its own.
 */
export const SCAFFOLDING_VOCABULARY: readonly string[] = [
  // Structure and connectives.
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'has',
  'have',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'to',
  'was',
  'were',
  'with',
  'been',
  'be',
  'this',
  'that',
  'than',
  'there',
  'no',
  'not',
  'none',
  'any',
  'also',
  'about',
  'up',
  'over',
  'during',
  'some',
  'were',
  // The reporting voice. The draft says who said what, and nothing else.
  'patient',
  'patients',
  'reports',
  'reported',
  'report',
  'states',
  'stated',
  'says',
  'said',
  'selected',
  'answered',
  'answer',
  'answers',
  'described',
  'describes',
  'indicated',
  'chose',
  'declined',
  'prefers',
  'prefer',
  'preferred',
  'discuss',
  'doctor',
  'clinician',
  'unsure',
  'sure',
  'applicable',
  'apply',
  'applies',
  // Section headings and their words.
  'reason',
  'visit',
  'duration',
  'onset',
  'severity',
  'impact',
  'current',
  'medicine',
  'medicines',
  'medication',
  'medications',
  'allergy',
  'allergies',
  'history',
  'past',
  'documents',
  'document',
  'previous',
  'records',
  'record',
  'complaint',
  'symptom',
  'symptoms',
  'information',
  'details',
  'section',
  'sections',
  'question',
  'questions',
  'summary',
  'draft',
  'verified',
  'assisted',
  'consultation',
  'pre',
  // Provenance wording, so the labels themselves do not trip the check.
  'extracted',
  'ocr',
  'verify',
  'source',
  'system',
  'detected',
  'review',
  'ai',
  'clinical',
  'diagnosis',
  'provided',
  // Counting and time scaffolding. Actual quantities must still be grounded.
  'day',
  'days',
  'week',
  'weeks',
  'month',
  'months',
  'year',
  'years',
  'today',
  'more',
  'less',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'uploaded',
  'attached',
  'awaiting',
];

/**
 * The sentence the doctor view must carry, from master prompt §17.
 *
 * Stating the absence of a diagnosis explicitly is stronger than omitting one: a reader
 * skimming a structured draft can mistake silence for "nothing found", and cannot mistake
 * this.
 */
export const NO_DIAGNOSIS_STATEMENT = 'Clinical diagnosis has not been provided.' as const;

/** Upper bounds. A draft nobody finishes reading is a draft that failed. */
export const DRAFT_LIMITS = {
  maxNarrativeChars: 1200,
  maxNarrativeSentences: 12,
  maxSections: 12,
  maxStatementsPerSection: 10,
  maxStatementChars: 300,
} as const;
