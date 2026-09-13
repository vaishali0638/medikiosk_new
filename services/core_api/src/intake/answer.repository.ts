import { Inject, Injectable } from '@nestjs/common';
import type { AnswerLookup } from '@medikiosk/questionnaire-schema';
import type { AnswerModality, ProvenanceSource } from '@medikiosk/api-contracts';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import { withSerializableRetry } from '../db/transaction';

export interface RecordAnswerInput {
  readonly preCheckinId: string;
  readonly questionnaireKey: string;
  readonly questionnaireVersion: string;
  readonly questionId: string;
  /** Selected option ids, or a single free-text/scale value. */
  readonly value: unknown;
  /** Option ids, used for branching. Empty for text answers. */
  readonly selectedOptionIds: readonly string[];
  readonly source: ProvenanceSource;
  readonly modality: AnswerModality;
  readonly languageTag: string;
  readonly confidence?: number | undefined;
}

export interface StoredAnswer {
  readonly questionId: string;
  readonly value: unknown;
  readonly selectedOptionIds: readonly string[];
  readonly source: ProvenanceSource;
  readonly modality: AnswerModality;
  readonly revision: number;
  readonly answeredAt: string;
}

@Injectable()
export class AnswerRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Records an answer as a new revision.
   *
   * Answers APPEND, never overwrite. A patient who changes their mind on the review
   * screen produces a second revision, and the doctor can see that they did — which
   * matters when the change is "actually I do take that medicine".
   */
  async record(input: RecordAnswerInput): Promise<number> {
    return withSerializableRetry(this.db, async (trx) => {
      const latest = await trx
        .selectFrom('questionnaire_response')
        .select('revision')
        .where('pre_checkin_id', '=', input.preCheckinId)
        .where('question_id', '=', input.questionId)
        .orderBy('revision', 'desc')
        .limit(1)
        .executeTakeFirst();

      const revision = (latest?.revision ?? 0) + 1;

      await trx
        .insertInto('questionnaire_response')
        .values({
          pre_checkin_id: input.preCheckinId,
          questionnaire_key: input.questionnaireKey,
          questionnaire_ver: input.questionnaireVersion,
          question_id: input.questionId,
          answer: JSON.stringify({
            value: input.value,
            selectedOptionIds: input.selectedOptionIds,
          }),
          source: input.source,
          modality: input.modality,
          language_tag: input.languageTag,
          confidence: input.confidence ?? null,
          revision,
        })
        .execute();

      return revision;
    });
  }

  /** The latest revision of every answer, for branching and for the review screen. */
  async latest(preCheckinId: string): Promise<StoredAnswer[]> {
    const rows = await this.db
      .selectFrom('questionnaire_response')
      .selectAll()
      .where('pre_checkin_id', '=', preCheckinId)
      .orderBy('question_id', 'asc')
      .orderBy('revision', 'desc')
      .execute();

    const seen = new Set<string>();
    const latest: StoredAnswer[] = [];

    for (const row of rows) {
      if (seen.has(row.question_id)) continue;
      seen.add(row.question_id);

      const answer = row.answer as { value?: unknown; selectedOptionIds?: string[] };
      latest.push({
        questionId: row.question_id,
        value: answer.value,
        selectedOptionIds: answer.selectedOptionIds ?? [],
        source: row.source,
        modality: row.modality,
        revision: row.revision,
        answeredAt: row.created_at.toISOString(),
      });
    }

    return latest;
  }

  /** The shape the branching engine evaluates against. */
  async lookup(preCheckinId: string): Promise<AnswerLookup> {
    const answers = await this.latest(preCheckinId);
    const lookup: Record<string, string[]> = {};
    for (const answer of answers) {
      lookup[answer.questionId] = [...answer.selectedOptionIds];
    }
    return lookup;
  }

  /** Every revision of one question, so a reviewer can see what changed. */
  async history(preCheckinId: string, questionId: string): Promise<StoredAnswer[]> {
    const rows = await this.db
      .selectFrom('questionnaire_response')
      .selectAll()
      .where('pre_checkin_id', '=', preCheckinId)
      .where('question_id', '=', questionId)
      .orderBy('revision', 'asc')
      .execute();

    return rows.map((row) => {
      const answer = row.answer as { value?: unknown; selectedOptionIds?: string[] };
      return {
        questionId: row.question_id,
        value: answer.value,
        selectedOptionIds: answer.selectedOptionIds ?? [],
        source: row.source,
        modality: row.modality,
        revision: row.revision,
        answeredAt: row.created_at.toISOString(),
      };
    });
  }
}
