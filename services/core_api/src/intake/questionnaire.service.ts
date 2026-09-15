import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import {
  applicableQuestions,
  compose,
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

/** AYUSH system code -> the module content key it publishes under. */
export function ayushModuleKey(system: string): string {
  return system.toLowerCase().replace(/_/g, '-');
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
    /** The kiosk asking. Supplied where there is one; a patient's phone has none. */
    kioskCode?: string,
  ): Promise<Questionnaire | undefined> {
    const row = await this.db
      .selectFrom('governance_version')
      .select(['semver', 'payload', 'approvals'])
      .where('hospital_id', '=', hospitalId)
      .where('content_kind', '=', 'QUESTIONNAIRE')
      .where('content_key', '=', questionnaireKey(key, language))
      // A canary reaches only the kiosks it names; everything else gets the published
      // version. Ordered so that when both exist for a canary kiosk, the canary wins —
      // that is what being in the canary means.
      .where((eb) =>
        eb.or([
          eb('state', '=', 'PUBLISHED'),
          eb.and([
            eb('state', '=', 'CANARY'),
            eb(sql<boolean>`${kioskCode ?? null} = ANY(canary_kiosk_codes)`, '=', true),
          ]),
        ]),
      )
      .orderBy(sql`CASE WHEN state = 'CANARY' THEN 0 ELSE 1 END`)
      .executeTakeFirst();

    if (!row) return undefined;

    const approvals = Array.isArray(row.approvals) ? row.approvals : [];
    const parsed = questionnaireSchema.safeParse({
      ...(row.payload as Record<string, unknown>),
      // The REGISTRY semver, not the payload's own `version` field.
      //
      // Two sources of truth for one version number is the bug: the payload is authored
      // text and can say anything, while the semver is what the approval gate checks, what
      // a rollback moves between, and what is unique per key. With the payload winning, a
      // release governed as 1.0.0 could hand the kiosk content calling itself
      // 0.1.0-placeholder — and every answer would cite the claim rather than the release
      // it actually came from.
      version: row.semver,
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

  /**
   * Loads the common core, composed with the AYUSH module for the selected system.
   *
   * A system with no PUBLISHED module gets the core alone rather than an error. That is
   * deliberate: a hospital may run an Ayurveda OPD long before its Ayurveda module has
   * been through practitioner review, and the right behaviour then is to collect the
   * history every clinician needs — not to refuse the patient. Which module was used, or
   * that none was, is recorded in the composed version string.
   */
  async findComposed(
    hospitalId: string,
    coreKey: string,
    language: string,
    ayushSystem?: string | null,
    /** The kiosk asking, so a canary reaches only the kiosks it names. */
    kioskCode?: string,
  ): Promise<{ questionnaire: Questionnaire; moduleUsed: string | null } | undefined> {
    const core = await this.findPublished(hospitalId, coreKey, language, kioskCode);
    if (!core) return undefined;

    if (!ayushSystem) return { questionnaire: core, moduleUsed: null };

    const moduleKey = ayushModuleKey(ayushSystem);
    const module = await this.findPublishedModule(hospitalId, moduleKey, language);
    if (!module) return { questionnaire: core, moduleUsed: null };

    const { questionnaire, problems } = compose(core, module);
    if (problems.length > 0) {
      // A module that collides with the core would make a stored answer ambiguous. Fail
      // loudly at load rather than serving a questionnaire nobody can interpret later.
      throw new Error(
        `Cannot compose ${moduleKey} onto ${coreKey} for ${language}: ${problems.join('; ')}`,
      );
    }

    return { questionnaire, moduleUsed: moduleKey };
  }

  /** The AYUSH system a department practises, if any. The single source for a visit. */
  async systemForDepartment(departmentId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('department')
      .select('ayush_system')
      .where('id', '=', departmentId)
      .executeTakeFirst();
    return row?.ayush_system ?? null;
  }

  /** A published AYUSH module. Same validation as the core — it is a questionnaire too. */
  async findPublishedModule(
    hospitalId: string,
    moduleKey: string,
    language: string,
  ): Promise<Questionnaire | undefined> {
    const row = await this.db
      .selectFrom('governance_version')
      .select(['semver', 'payload', 'approvals'])
      .where('hospital_id', '=', hospitalId)
      .where('content_kind', '=', 'AYUSH_MODULE')
      .where('content_key', '=', questionnaireKey(moduleKey, language))
      .where('state', '=', 'PUBLISHED')
      .executeTakeFirst();

    if (!row) return undefined;

    const approvals = Array.isArray(row.approvals) ? row.approvals : [];
    const parsed = questionnaireSchema.safeParse({
      ...(row.payload as Record<string, unknown>),
      // The REGISTRY semver, not the payload's own `version` field.
      //
      // Two sources of truth for one version number is the bug: the payload is authored
      // text and can say anything, while the semver is what the approval gate checks, what
      // a rollback moves between, and what is unique per key. With the payload winning, a
      // release governed as 1.0.0 could hand the kiosk content calling itself
      // 0.1.0-placeholder — and every answer would cite the claim rather than the release
      // it actually came from.
      version: row.semver,
      language,
      approvedBy: approvals.map((a) => (a as { by?: string }).by ?? 'UNKNOWN'),
    });

    if (!parsed.success) {
      throw new Error(`Published AYUSH module ${moduleKey}/${language} is malformed`);
    }

    const problems = validateQuestionnaire(parsed.data);
    if (problems.length > 0) {
      throw new Error(
        `Published AYUSH module ${moduleKey}/${language} is invalid: ${problems.join('; ')}`,
      );
    }

    return parsed.data;
  }

  /**
   * AYUSH systems this hospital can actually run an intake for.
   *
   * A system appears only when it has BOTH an enabled department and a published module.
   * Offering one without a module would let a patient choose a system of medicine and
   * then be asked nothing specific to it — which looks like the module failed rather than
   * like it was never approved.
   */
  async availableAyushSystems(hospitalId: string, language: string): Promise<string[]> {
    const departments = await this.db
      .selectFrom('department')
      .innerJoin('branch', 'branch.id', 'department.branch_id')
      .select('department.ayush_system as system')
      .where('branch.hospital_id', '=', hospitalId)
      .where('department.enabled', '=', true)
      .where('department.ayush_system', 'is not', null)
      .execute();

    const published = await this.db
      .selectFrom('governance_version')
      .select('content_key')
      .where('hospital_id', '=', hospitalId)
      .where('content_kind', '=', 'AYUSH_MODULE')
      .where('state', '=', 'PUBLISHED')
      .execute();

    const publishedKeys = new Set(published.map((r) => r.content_key));

    const systems = departments
      .map((d) => d.system)
      .filter((s): s is NonNullable<typeof s> => s !== null);

    return [...new Set<string>(systems)]
      .filter((system) => publishedKeys.has(questionnaireKey(ayushModuleKey(system), language)))
      .sort();
  }

  /** The next question, given the answers recorded so far. Null when the interview is done. */
  next(
    questionnaire: Questionnaire,
    answers: AnswerLookup,
    answeredQuestionIds: ReadonlySet<string>,
  ): NextQuestion | null {
    return nextQuestion(questionnaire, answers, answeredQuestionIds);
  }

  /** Every question that currently applies, for the review screen. */
  applicable(
    questionnaire: Questionnaire,
    answers: AnswerLookup,
    answeredQuestionIds?: ReadonlySet<string>,
  ): readonly Question[] {
    return applicableQuestions(questionnaire, answers, answeredQuestionIds);
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
