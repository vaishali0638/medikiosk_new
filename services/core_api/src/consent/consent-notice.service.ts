import { Inject, Injectable } from '@nestjs/common';
import { consentNoticeSchema, type ConsentNotice } from '@medikiosk/api-contracts';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';

/** `content_key` for a notice in a given language, e.g. `consent-notice/hi`. */
export function consentNoticeKey(language: string): string {
  return `consent-notice/${language}`;
}

@Injectable()
export class ConsentNoticeService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Returns the published notice for a hospital and language, or undefined.
   *
   * There is deliberately no language fallback. Serving an English notice to a patient
   * who selected Hindi would ask them to agree to wording they cannot read, which is not
   * consent in any meaningful sense — so an unpublished language blocks the flow instead.
   *
   * The stored payload is validated against the contract before it is returned. Governed
   * content is edited by reviewers through the console, and a malformed release must fail
   * loudly here rather than render a half-empty consent screen.
   */
  async findPublished(hospitalId: string, language: string): Promise<ConsentNotice | undefined> {
    const row = await this.db
      .selectFrom('governance_version')
      .select(['semver', 'payload', 'approvals', 'effective_from'])
      .where('hospital_id', '=', hospitalId)
      .where('content_kind', '=', 'CONSENT_NOTICE')
      .where('content_key', '=', consentNoticeKey(language))
      .where('state', '=', 'PUBLISHED')
      .executeTakeFirst();

    if (!row) return undefined;

    const payload = row.payload as Record<string, unknown>;
    const approvals = Array.isArray(row.approvals) ? row.approvals : [];

    const parsed = consentNoticeSchema.safeParse({
      ...payload,
      version: payload['version'] ?? row.semver,
      language,
      approvedBy: approvals.map((a) => (a as { by?: string }).by ?? 'UNKNOWN'),
      effectiveFrom: (row.effective_from ?? new Date()).toISOString(),
    });

    if (!parsed.success) {
      throw new Error(
        `Published consent notice for ${language} is malformed: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  /** Languages that actually have a published notice. Used by the config endpoint. */
  async publishedLanguages(hospitalId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('governance_version')
      .select('content_key')
      .where('hospital_id', '=', hospitalId)
      .where('content_kind', '=', 'CONSENT_NOTICE')
      .where('state', '=', 'PUBLISHED')
      .execute();

    return rows
      .map((r) => r.content_key.split('/')[1])
      .filter((tag): tag is string => tag !== undefined)
      .sort();
  }
}
