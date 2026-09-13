import { Inject, Injectable } from '@nestjs/common';
import {
  applicableQuestions,
  nextQuestion,
  questionnaireSchema,
  validateQuestionnaire,
  type AnswerLookup,
  type NextQuestion,
  type Question,
  type Questionnaire,
} from '@medikiosk/questionnaire-schema';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import { DomainError } from '../common/domain-error';

/** `content_key` for a questionnaire in a given language, e.g. `common-core/hi`. */
export function questionnaireKey(key: string, language: string): string {
  return `${key}/${language}`;
}

@Injectable()
export class QuestionnaireService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Loads the published questionnaire for a hospital and language.
   *
   * No cross-language fallback, for the same reason as the consent notice: answers given
   * against questions the patient could not read are not answers.
   *
   * The stored payload is re-validated on every load. Governed content is edited by
   * reviewers through a console, and a release that would strand a patient mid-interview
   * must fail loudly here rather than halfway through their intake.
   */
  async findPublished(
    hospitalId: string,
    key: string,
    language: string,
  ): Promise<Questionnaire | undefined> {
    const row = await this.db
      .selectFrom('governance_version')
      .select(['semver', 'payload', 'approvals'])
      .where('hospital_id', '=', hospitalId)
      .where('content_kind', '=', 'QUESTIONNAIRE')
      .where('content_key', '=', questionnaireKey(key, language))
      .where('state', '=', 'PUBLISHED')
      .executeTakeFirst();

    if (!row) return undefined;

    const approvals = Array.isArray(row.approvals) ? row.approvals : [];
    const parsed = questionnaireSchema.safeParse({
      ...(row.payload as Record<string, unknown>),
      version: (row.payload as { version?: string }).version ?? row.semver,
      language,
      approvedBy: approvals.map((a) => (a as { by?: string }).by ?? 'UNKNOWN'),
    });

    if (!parsed.success) {
      throw new Error(
        `Published questionnaire ${key}/${language} is malformed: ${parsed.error.message}`,
      );
    }

    const problems = validateQuestionnaire(parsed.data);
    if (problems.length > 0) {
      throw new Error(
        `Published questionnaire ${key}/${language} is structurally invalid: ${problems.join('; ')}`,
      );
    }

    return parsed.data;
  }

  /** The next question, given the answers recorded so far. Null when the interview is done. */
  next(questionnaire: Questionnaire, answers: AnswerLookup): NextQuestion | null {
    return nextQuestion(questionnaire, answers);
  }

  /** Every question that currently applies, for the review screen. */
  applicable(questionnaire: Questionnaire, answers: AnswerLookup): readonly Question[] {
    return applicableQuestions(questionnaire, answers);
  }

  /**
   * Finds the question an answer claims to be for, in the version it claims.
   *
   * An answer to a question that does not exist in the version being used is refused
   * rather than stored: a stored answer whose question cannot be reconstructed is not a
   * clinical record, it is a loose string.
   */
  requireQuestion(
    questionnaire: Questionnaire,
    questionId: string,
    correlationId: string,
  ): Question {
    const node = questionnaire.nodes.find((n) => n.question.id === questionId);
    if (!node) {
      throw new DomainError(
        'VALIDATION_FAILED',
        correlationId,
        `question ${questionId} is not in ${questionnaire.key}@${questionnaire.version}`,
      );
    }
    return node.question;
  }
}
