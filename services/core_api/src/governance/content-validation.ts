import { questionnaireSchema } from '@medikiosk/questionnaire-schema';
import { z } from 'zod';

/**
 * Checks that governed content is loadable before anyone spends a review cycle on it.
 *
 * This is schema validation, not clinical review. It cannot tell whether a Prakriti
 * question is sound — only a practitioner can — but it can tell that the file will parse,
 * that its option ids are unique, and that its branching refers to questions that exist.
 * Catching those at authoring saves four reviewers reading something that was never
 * loadable in the first place.
 */

const consentNoticeSchema = z.object({
  version: z.string().min(1),
  language: z.string().min(2).max(16),
  title: z.string().min(1),
  collectedItems: z.array(z.string().min(1)).min(1),
  purpose: z.string().min(1),
  fullText: z.string().min(1),
  audioAvailable: z.boolean().optional(),
  approvedBy: z.array(z.string()).optional(),
});

/** Returns every problem, or an empty list. */
export function validateContent(contentKind: string, payload: unknown): string[] {
  switch (contentKind) {
    case 'QUESTIONNAIRE':
    case 'AYUSH_MODULE':
    case 'COMPLAINT_BRANCH':
      return validateQuestionnaireContent(payload);

    case 'CONSENT_NOTICE': {
      const parsed = consentNoticeSchema.safeParse(payload);
      return parsed.success ? [] : parsed.error.issues.map(describe);
    }

    default:
      // An unknown kind is not waved through as valid, but neither is it rejected: the
      // registry is meant to grow, and a hospital adding a terminology set should not
      // need a code change. It gets the weakest check there is — it must be an object.
      return typeof payload === 'object' && payload !== null
        ? []
        : ['content must be a JSON object'];
  }
}

function validateQuestionnaireContent(payload: unknown): string[] {
  // `language`, `version` and `approvedBy` are supplied by the REGISTRY ROW when the
  // content is loaded — from the content key, the semver, and the recorded approvals —
  // and are deliberately absent from the authored file. Validating the raw payload against
  // the full schema rejected every real questionnaire in the repository for missing a
  // field it is not supposed to carry. Placeholders stand in for them so this checks the
  // structure an author is actually responsible for.
  const augmented =
    typeof payload === 'object' && payload !== null
      ? { language: 'xx', approvedBy: [], version: '0.0.0', ...payload }
      : payload;

  const parsed = questionnaireSchema.safeParse(augmented);
  if (!parsed.success) return parsed.error.issues.map(describe);

  const problems: string[] = [];
  const questionnaire = parsed.data;

  const ids = new Set<string>();
  for (const node of questionnaire.nodes) {
    if (ids.has(node.question.id)) {
      // Two questions with one id means an answer to either is indistinguishable from an
      // answer to the other, in the record and in the branching.
      problems.push(`duplicate question id: ${node.question.id}`);
    }
    ids.add(node.question.id);

    const optionIds = new Set<string>();
    for (const option of node.question.options ?? []) {
      if (optionIds.has(option.id)) {
        problems.push(`duplicate option id ${option.id} in ${node.question.id}`);
      }
      optionIds.add(option.id);
    }
  }

  // Branching must refer to questions that exist and that come EARLIER. A condition on a
  // later answer can never be true, so the question it guards is unreachable — content
  // that looks complete to a reviewer and asks a patient nothing.
  const seen = new Set<string>();
  for (const node of questionnaire.nodes) {
    for (const referenced of referencedQuestionIds(node.askWhen)) {
      if (!ids.has(referenced)) {
        problems.push(`${node.question.id} branches on unknown question ${referenced}`);
      } else if (!seen.has(referenced)) {
        problems.push(`${node.question.id} branches on ${referenced}, which is asked later`);
      }
    }
    seen.add(node.question.id);
  }

  return problems;
}

/** Every question id a branching condition depends on, however deeply nested. */
function referencedQuestionIds(condition: unknown): string[] {
  if (typeof condition !== 'object' || condition === null) return [];
  const node = condition as Record<string, unknown>;

  const ids: string[] = [];
  if (typeof node['questionId'] === 'string') ids.push(node['questionId']);

  // ALL and ANY nest an array under `of`; NOT nests a single condition under the same key.
  const nested = node['of'];
  if (Array.isArray(nested)) {
    for (const child of nested) ids.push(...referencedQuestionIds(child));
  } else if (nested !== undefined) {
    ids.push(...referencedQuestionIds(nested));
  }
  return ids;
}

function describe(issue: z.ZodIssue): string {
  const path = issue.path.join('.');
  return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
}
