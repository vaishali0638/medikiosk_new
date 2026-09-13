import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PROVENANCE_LABELS } from '@medikiosk/terminology';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import { AuditRepository } from '../audit/audit.repository';
import { COMPOSER_VERSION, compose, type ComposeInput } from './deterministic-composer';
import { DRAFT_GENERATOR, type DraftGenerator } from './generator.adapter';
import { validateDraft, type GroundingMaterial, type ValidationProblem } from './safety-validator';
import type { ClinicalDraft } from './draft.contract';

export interface DraftResult {
  readonly summaryId: string;
  readonly draft: ClinicalDraft;
  readonly generator: 'DETERMINISTIC' | 'MODEL';
  readonly generatorVersion: string;
  readonly label: string;
  /** True when a model draft was refused and the rules-based one was used instead. */
  readonly fellBack: boolean;
}

@Injectable()
export class SummaryService {
  private readonly logger = new Logger(SummaryService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditRepository,
    @Optional() @Inject(DRAFT_GENERATOR) private readonly generator?: DraftGenerator,
  ) {}

  /**
   * Produces the draft a clinician will read.
   *
   * The model gets first attempt; the validator decides whether its output is used. A
   * refusal is not an error — it is the control working — so the deterministic composer
   * runs and the patient's visit continues at full speed. The refused candidate is stored
   * anyway: it is the evidence of what a generator tried to put in front of a clinician,
   * and deleting exactly the events worth reviewing would be the wrong instinct.
   */
  async generate(
    preCheckinId: string,
    input: ComposeInput,
    material: GroundingMaterial,
    correlationId: string,
    actorId: string,
  ): Promise<DraftResult> {
    let fellBack = false;

    if (this.generator) {
      const candidate = await this.tryGenerator(input);
      if (candidate !== undefined) {
        const verdict = validateDraft(candidate, material);
        if (verdict.ok) {
          return this.persist({
            preCheckinId,
            draft: verdict.draft,
            generator: 'MODEL',
            generatorVersion: this.generator.version,
            correlationId,
            actorId,
            fellBack: false,
          });
        }

        await this.persistRejection(
          preCheckinId,
          candidate,
          verdict.problems,
          this.generator.version,
          correlationId,
          actorId,
        );
        fellBack = true;
      } else {
        fellBack = true;
      }
    }

    // The specified fallback: with no model, or a refused one, the patient still gets a
    // complete, labelled draft built from what they actually answered.
    return this.persist({
      preCheckinId,
      draft: compose(input),
      generator: 'DETERMINISTIC',
      generatorVersion: COMPOSER_VERSION,
      correlationId,
      actorId,
      fellBack,
    });
  }

  /** Returns undefined rather than throwing: an unavailable generator is a normal state. */
  private async tryGenerator(input: ComposeInput): Promise<unknown | undefined> {
    try {
      return await this.generator?.generate(input);
    } catch {
      return undefined;
    }
  }

  private async persist(args: {
    preCheckinId: string;
    draft: ClinicalDraft;
    generator: 'DETERMINISTIC' | 'MODEL';
    generatorVersion: string;
    correlationId: string;
    actorId: string;
    fellBack: boolean;
  }): Promise<DraftResult> {
    const row = await this.db
      .insertInto('clinical_summary')
      .values({
        pre_checkin_id: args.preCheckinId,
        generator: args.generator,
        generator_version: args.generatorVersion,
        content: JSON.stringify(args.draft),
        validation_state: 'ACCEPTED',
        rejection_reasons: JSON.stringify([]),
        // The only label this phase can write. The database refuses any other value
        // unless a clinician and a timestamp are set, and nothing here sets them.
        provenance_label: PROVENANCE_LABELS.AI_ASSISTED_DRAFT,
        correlation_id: args.correlationId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await this.audit.append({
      actorId: args.actorId,
      actorRole: 'kiosk',
      action: 'SUMMARY_DRAFTED',
      entityType: 'clinical_summary',
      entityId: row.id,
      correlationId: args.correlationId,
      // No narrative in the audit detail. The row holds the content; the log holds the
      // fact that it was produced and by what.
      detail: {
        generator: args.generator,
        generatorVersion: args.generatorVersion,
        fellBack: args.fellBack,
        sections: args.draft.sections.length,
      },
    });

    return {
      summaryId: row.id,
      draft: args.draft,
      generator: args.generator,
      generatorVersion: args.generatorVersion,
      label: PROVENANCE_LABELS.AI_ASSISTED_DRAFT,
      fellBack: args.fellBack,
    };
  }

  private async persistRejection(
    preCheckinId: string,
    candidate: unknown,
    problems: readonly ValidationProblem[],
    generatorVersion: string,
    correlationId: string,
    actorId: string,
  ): Promise<void> {
    const row = await this.db
      .insertInto('clinical_summary')
      .values({
        pre_checkin_id: preCheckinId,
        generator: 'MODEL',
        generator_version: generatorVersion,
        // Stored as given, including malformed output: what a generator actually emitted
        // is the whole value of keeping the row.
        content: JSON.stringify(candidate),
        validation_state: 'REJECTED',
        rejection_reasons: JSON.stringify(problems),
        provenance_label: PROVENANCE_LABELS.AI_ASSISTED_DRAFT,
        correlation_id: correlationId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Warn, not error: the gate held. A pattern of these is a signal about the generator,
    // which is why the codes are in the log and the text is not.
    this.logger.warn(
      `draft refused (${problems.map((p) => p.code).join(', ')}) correlationId=${correlationId}`,
    );

    await this.audit.append({
      actorId,
      actorRole: 'kiosk',
      action: 'SUMMARY_REFUSED',
      entityType: 'clinical_summary',
      entityId: row.id,
      correlationId,
      // Named `rule`, not `code`: the audit redactor strips any field called `code`,
      // because that is where OTPs live. The name is more accurate here anyway — it is
      // the validation rule that fired.
      detail: { problems: problems.map((p) => ({ rule: p.code, where: p.where })) },
    });
  }

  /** The most recent accepted draft for a visit. */
  async latestFor(preCheckinId: string): Promise<DraftResult | null> {
    const row = await this.db
      .selectFrom('clinical_summary')
      .selectAll()
      .where('pre_checkin_id', '=', preCheckinId)
      .where('validation_state', '=', 'ACCEPTED')
      .orderBy('created_at', 'desc')
      .executeTakeFirst();

    if (!row) return null;

    return {
      summaryId: row.id,
      draft: row.content as ClinicalDraft,
      generator: row.generator,
      generatorVersion: row.generator_version,
      label: row.provenance_label,
      fellBack: false,
    };
  }
}
