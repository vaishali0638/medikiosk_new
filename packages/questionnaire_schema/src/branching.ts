import { z } from 'zod';

/**
 * A branching condition.
 *
 * Deliberately a tiny, total language: equality, membership, presence and answeredness,
 * combined with all/any. It cannot loop, cannot call out, and cannot express anything
 * whose result depends on something other than the answers already given.
 *
 * That narrowness is the point. The specification is explicit that an LLM must not choose
 * the clinical interview, and the way to guarantee that is to make the interview's control
 * flow something a reviewer can read in full and a machine can evaluate deterministically.
 */
export type Condition =
  | { readonly kind: 'ALWAYS' }
  | { readonly kind: 'ANSWERED'; readonly questionId: string }
  | { readonly kind: 'EQUALS'; readonly questionId: string; readonly value: string }
  | { readonly kind: 'IN'; readonly questionId: string; readonly values: readonly string[] }
  | { readonly kind: 'ALL'; readonly of: readonly Condition[] }
  | { readonly kind: 'ANY'; readonly of: readonly Condition[] }
  | { readonly kind: 'NOT'; readonly of: Condition };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('ALWAYS') }),
    z.object({ kind: z.literal('ANSWERED'), questionId: z.string().min(1) }),
    z.object({ kind: z.literal('EQUALS'), questionId: z.string().min(1), value: z.string() }),
    z.object({
      kind: z.literal('IN'),
      questionId: z.string().min(1),
      values: z.array(z.string()).min(1),
    }),
    z.object({ kind: z.literal('ALL'), of: z.array(conditionSchema).min(1) }),
    z.object({ kind: z.literal('ANY'), of: z.array(conditionSchema).min(1) }),
    z.object({ kind: z.literal('NOT'), of: conditionSchema }),
  ]),
) as z.ZodType<Condition>;

/** The answer values a condition is evaluated against: question id -> selected option ids. */
export type AnswerLookup = Readonly<Record<string, readonly string[]>>;

/**
 * Evaluates a condition against the answers so far.
 *
 * Total: every branch returns, and an unknown question is simply unanswered rather than
 * an error. A questionnaire that references a question it never asks should not be able
 * to strand a patient mid-interview.
 */
export function evaluate(
  condition: Condition,
  answers: AnswerLookup,
  /**
   * Which questions were answered at all. See `nextQuestion` for why this cannot be
   * derived from `answers`: an answer carrying a value rather than a selection contributes
   * an empty array, so ANSWERED read as false for every scale, date and free-text answer —
   * and a branch that depended on one could never be taken.
   */
  answeredQuestionIds?: ReadonlySet<string>,
): boolean {
  switch (condition.kind) {
    case 'ALWAYS':
      return true;
    case 'ANSWERED':
      return (
        answeredQuestionIds?.has(condition.questionId) ??
        (answers[condition.questionId]?.length ?? 0) > 0
      );
    case 'EQUALS':
      return answers[condition.questionId]?.includes(condition.value) ?? false;
    case 'IN':
      return (answers[condition.questionId] ?? []).some((v) => condition.values.includes(v));
    case 'ALL':
      return condition.of.every((c) => evaluate(c, answers, answeredQuestionIds));
    case 'ANY':
      return condition.of.some((c) => evaluate(c, answers, answeredQuestionIds));
    case 'NOT':
      return !evaluate(condition.of, answers, answeredQuestionIds);
  }
}
