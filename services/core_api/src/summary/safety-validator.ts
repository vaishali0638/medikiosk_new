import {
  BANNED_PATTERNS,
  DRAFT_LIMITS,
  NO_DIAGNOSIS_STATEMENT,
  SCAFFOLDING_VOCABULARY,
  type BannedPattern,
} from '@medikiosk/terminology';
import { clinicalDraftSchema, type ClinicalDraft } from './draft.contract';

/**
 * The gate between any draft generator and a clinician's screen.
 *
 * It is written as a pure function over (draft, grounding material) with no knowledge of
 * where the draft came from. The deterministic composer in this repository is checked by
 * it, exactly as a language model would be. That is not ceremony: a validator its own
 * author's output cannot pass is a validator nobody will trust, and one that is only ever
 * run against a model is one that has never been tested against a known-good input.
 */

export interface ValidationProblem {
  readonly code: string;
  readonly detail: string;
  /** Where it was found: a section key, or 'narrative'. */
  readonly where: string;
}

export type ValidationResult =
  | { readonly ok: true; readonly draft: ClinicalDraft }
  | { readonly ok: false; readonly problems: readonly ValidationProblem[] };

/** Everything the patient actually said, plus what their documents are labelled as. */
export interface GroundingMaterial {
  /** Question prompts, option labels, and free-text answers, in any language. */
  readonly answerTexts: readonly string[];
  /** Document type labels, filenames excluded. */
  readonly documentLabels: readonly string[];
}

const WORD = /[\p{L}\p{N}]+/gu;

/** Words split out of the grounding material, lowercased. */
function vocabularyOf(material: GroundingMaterial): Set<string> {
  const vocabulary = new Set<string>(SCAFFOLDING_VOCABULARY);
  for (const text of [...material.answerTexts, ...material.documentLabels]) {
    for (const word of text.toLowerCase().match(WORD) ?? []) {
      vocabulary.add(word);
    }
  }
  return vocabulary;
}

/** Quoted spans, in straight or typographic quotes. */
const QUOTED_SPAN = /"[^"]*"|\u201c[^\u201d]*\u201d/g;

/**
 * Removes what the patient said, leaving what the system said about it.
 *
 * The banned-language rules describe a voice the kiosk may not adopt; they are not a
 * censor on the patient. A patient who says "it is probably from lifting a sack" has said
 * something a doctor should read verbatim, and refusing the draft over their word
 * "probably" would either lose the detail or force the generator to paraphrase a symptom
 * description — which is worse than the phrase it was avoiding.
 *
 * So a quoted span is exempt from the banned scan. Grounding still applies to it, and a
 * quote can only contain words the patient used, so this cannot be used to smuggle a
 * diagnosis in: quoting text the patient never said fails the grounding check instead.
 */
function systemVoiceOf(text: string): string {
  return text.replace(QUOTED_SPAN, ' ');
}

function scanBanned(text: string, where: string): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const voice = systemVoiceOf(text);
  for (const rule of BANNED_PATTERNS as readonly BannedPattern[]) {
    const match = rule.pattern.exec(voice);
    if (match) {
      problems.push({
        code: rule.code,
        // The matched phrase, not the whole sentence: enough for a reviewer to see what
        // tripped, without copying a clinical narrative into a log line.
        detail: `${rule.why} Found: "${match[0]}".`,
        where,
      });
    }
  }
  return problems;
}

function scanUngrounded(
  text: string,
  where: string,
  vocabulary: ReadonlySet<string>,
): ValidationProblem[] {
  const unsupported = new Set<string>();
  for (const word of text.toLowerCase().match(WORD) ?? []) {
    if (!vocabulary.has(word)) unsupported.add(word);
  }
  if (unsupported.size === 0) return [];

  return [
    {
      code: 'UNGROUNDED_TERM',
      detail:
        'Contains wording the patient did not use and that is not permitted scaffolding: ' +
        `${[...unsupported].sort().join(', ')}.`,
      where,
    },
  ];
}

/**
 * Checks a draft, whatever produced it.
 *
 * Returns EVERY problem rather than the first. A generator being tuned against this gate
 * should see the whole picture in one pass; fixing one banned phrase and rediscovering an
 * ungrounded term on the next run wastes a cycle and teaches the wrong lesson about which
 * rule matters.
 */
export function validateDraft(candidate: unknown, material: GroundingMaterial): ValidationResult {
  const parsed = clinicalDraftSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => ({
        code: 'SCHEMA_INVALID',
        detail: issue.message,
        where: issue.path.join('.') || 'draft',
      })),
    };
  }

  const draft = parsed.data;
  const vocabulary = vocabularyOf(material);
  const problems: ValidationProblem[] = [];

  problems.push(...scanBanned(draft.narrative, 'narrative'));
  problems.push(...scanUngrounded(draft.narrative, 'narrative', vocabulary));

  // Counted on periods rather than a sentence tokenizer, which is crude and is meant to
  // be: the limit exists to stop a wall of text, not to measure prose.
  const sentences = draft.narrative.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  if (sentences.length > DRAFT_LIMITS.maxNarrativeSentences) {
    problems.push({
      code: 'NARRATIVE_TOO_LONG',
      detail: `${sentences.length} sentences; the limit is ${DRAFT_LIMITS.maxNarrativeSentences}.`,
      where: 'narrative',
    });
  }

  const seenKeys = new Set<string>();
  for (const section of draft.sections) {
    if (seenKeys.has(section.key)) {
      problems.push({
        code: 'DUPLICATE_SECTION',
        detail: `Section "${section.key}" appears more than once.`,
        where: section.key,
      });
    }
    seenKeys.add(section.key);

    problems.push(...scanBanned(section.heading, section.key));
    for (const statement of section.statements) {
      problems.push(...scanBanned(statement.text, section.key));
      problems.push(...scanUngrounded(statement.text, section.key, vocabulary));
    }
  }

  // The absence of a diagnosis is stated, not implied. A clinician skimming a structured
  // draft can read silence as "nothing found"; they cannot misread this sentence.
  if (!draft.narrative.includes(NO_DIAGNOSIS_STATEMENT)) {
    problems.push({
      code: 'MISSING_NO_DIAGNOSIS_STATEMENT',
      detail: `The narrative must contain: "${NO_DIAGNOSIS_STATEMENT}"`,
      where: 'narrative',
    });
  }

  return problems.length === 0 ? { ok: true, draft } : { ok: false, problems };
}
