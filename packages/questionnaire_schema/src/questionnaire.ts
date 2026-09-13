import { z } from 'zod';
import { conditionSchema, evaluate, type AnswerLookup, type Condition } from './branching';
import { questionSchema, type Question } from './question';

/** A question plus the condition under which it is asked. */
export const nodeSchema = z.object({
  question: questionSchema,
  /** Asked only when this holds. Omitted means always. */
  askWhen: conditionSchema.optional(),
});

export type QuestionnaireNode = z.infer<typeof nodeSchema>;

/**
 * A published questionnaire.
 *
 * This is DATA, authored and approved through the governance registry — never code. A
 * clinician changing a question must not require a deployment, and a developer must not
 * be able to change one without review. The engine that walks it lives in the API; the
 * content itself lives in `governance_version`.
 */
export const questionnaireSchema = z.object({
  key: z.string().min(1).max(64),
  /**
   * Semver, with an optional pre-release suffix.
   *
   * The suffix is load-bearing: content that has not been through practitioner review is
   * a PRE-RELEASE (`0.1.0-placeholder`), and `validateQuestionnaire` refuses a plain
   * release version with no named approval. So a version without a suffix is a claim that
   * someone signed it off, and that claim is checked.
   */
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  language: z.string().min(2).max(16),
  title: z.string().min(1),
  /** Ordered. Branching skips nodes; it never reorders them. */
  nodes: z.array(nodeSchema).min(1),
  /**
   * Named approvals. A questionnaire with none is not publishable, which is what stops
   * placeholder content reaching a patient by accident.
   */
  approvedBy: z.array(z.string()).default([]),
});

export type Questionnaire = z.infer<typeof questionnaireSchema>;

export interface NextQuestion {
  readonly question: Question;
  /** How far through: answered questions over questions that will be asked. */
  readonly answeredCount: number;
  readonly totalApplicable: number;
}

/**
 * Walks the questionnaire to the next unanswered applicable question.
 *
 * Ordered and deterministic: the same answers always produce the same next question, and
 * the whole path is reconstructable later from the stored answers plus the version. That
 * is what makes a completed interview auditable — a reviewer can replay exactly what the
 * patient was asked and why.
 */
export function nextQuestion(
  questionnaire: Questionnaire,
  answers: AnswerLookup,
): NextQuestion | null {
  const applicable = questionnaire.nodes.filter((node) =>
    node.askWhen ? evaluate(node.askWhen, answers) : true,
  );

  const answeredCount = applicable.filter(
    (node) => (answers[node.question.id]?.length ?? 0) > 0,
  ).length;

  const next = applicable.find((node) => (answers[node.question.id]?.length ?? 0) === 0);
  if (!next) return null;

  return {
    question: next.question,
    answeredCount,
    totalApplicable: applicable.length,
  };
}

/** Every question that currently applies, in order. Used to build the review screen. */
export function applicableQuestions(
  questionnaire: Questionnaire,
  answers: AnswerLookup,
): readonly Question[] {
  return questionnaire.nodes
    .filter((node) => (node.askWhen ? evaluate(node.askWhen, answers) : true))
    .map((node) => node.question);
}

/**
 * Structural checks a release must pass before it can be published.
 *
 * These are the mistakes that would strand a patient mid-interview or produce an
 * unauditable record, and they are cheap to catch at publish time and expensive to
 * discover at a kiosk.
 */
export function validateQuestionnaire(questionnaire: Questionnaire): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();

  // A release version asserts that a qualified practitioner approved this content. Content
  // that has not been reviewed must say so in its version, as a pre-release.
  const isPreRelease = questionnaire.version.includes('-');
  if (!isPreRelease && questionnaire.approvedBy.length === 0) {
    problems.push(
      `version ${questionnaire.version} is a release but names no approver; ` +
        'unreviewed content must use a pre-release version such as 0.1.0-draft',
    );
  }

  questionnaire.nodes.forEach((node, index) => {
    const { question } = node;

    if (ids.has(question.id)) problems.push(`duplicate question id "${question.id}"`);
    ids.add(question.id);

    if (
      (question.type === 'SINGLE_SELECT' ||
        question.type === 'MULTI_SELECT' ||
        question.type === 'DURATION') &&
      (question.options?.length ?? 0) === 0
    ) {
      problems.push(`"${question.id}" is ${question.type} but offers no options`);
    }

    if (question.type === 'NUMERIC_SCALE' && !question.scale) {
      problems.push(`"${question.id}" is NUMERIC_SCALE but defines no scale`);
    }

    if (question.sensitive && !question.sensitiveExplanation) {
      // A sensitive question without its explanation is the failure the "why are we
      // asking?" rule exists to prevent.
      problems.push(`"${question.id}" is sensitive but gives no explanation`);
    }

    if (question.nonCommittal.length === 0) {
      problems.push(`"${question.id}" offers no way to decline`);
    }

    // A condition may only reference questions asked EARLIER, or the patient can reach a
    // branch whose condition can never have been decided.
    const earlier = new Set(questionnaire.nodes.slice(0, index).map((n) => n.question.id));
    for (const referenced of referencedQuestions(node.askWhen)) {
      if (!earlier.has(referenced)) {
        problems.push(`"${question.id}" branches on "${referenced}", which is not asked before it`);
      }
    }
  });

  return problems;
}

function referencedQuestions(condition: Condition | undefined): string[] {
  if (!condition) return [];
  switch (condition.kind) {
    case 'ALWAYS':
      return [];
    case 'ANSWERED':
    case 'EQUALS':
    case 'IN':
      return [condition.questionId];
    case 'ALL':
    case 'ANY':
      return condition.of.flatMap(referencedQuestions);
    case 'NOT':
      return referencedQuestions(condition.of);
  }
}
