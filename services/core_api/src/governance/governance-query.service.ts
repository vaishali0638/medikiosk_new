import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';

/** Content a kiosk needs before it can run a clinical intake at all. */
const REQUIRED_CONTENT: readonly { kind: string; keyPrefix: string; why: string }[] = [
  {
    kind: 'CONSENT_NOTICE',
    keyPrefix: 'consent-notice/',
    why: 'a patient cannot be asked to agree to wording that does not exist',
  },
  {
    kind: 'QUESTIONNAIRE',
    keyPrefix: 'common-core/',
    why: 'there is no interview to conduct without one',
  },
];

@Injectable()
export class GovernanceQueryService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(hospitalId: string, contentKey?: string): Promise<unknown[]> {
    let query = this.db
      .selectFrom('governance_version')
      .select([
        'id',
        'content_kind as contentKind',
        'content_key as contentKey',
        'semver',
        'state',
        'approvals',
        'published_at as publishedAt',
        'published_by_user_id as publishedBy',
        'canary_kiosk_codes as canaryKioskCodes',
        'rollback_reason as rollbackReason',
        'created_at as createdAt',
      ])
      .where('hospital_id', '=', hospitalId)
      .orderBy('created_at', 'desc');

    if (contentKey) query = query.where('content_key', '=', contentKey);
    return query.execute();
  }

  /**
   * Which required content this hospital has nothing published for.
   *
   * The exit criterion is "no live content lacks a version". Stated that way it is a
   * promise; asked as a query it is checkable, and a governance console can show it as a
   * list of things that must be approved before the kiosk is usable.
   *
   * It reports per LANGUAGE, because a hospital offering Hindi with no Hindi consent
   * notice is not partly ready — it is a kiosk that will stop dead for every Hindi
   * speaker, and the summary "consent notice: published" would hide that.
   */
  async missingPublishedContent(
    hospitalId: string,
  ): Promise<{ kind: string; key: string; why: string }[]> {
    const languages = await this.db
      .selectFrom('hospital_language')
      .select('language_tag')
      .where('hospital_id', '=', hospitalId)
      .where('clinically_reviewed', '=', true)
      .execute();

    const published = await this.db
      .selectFrom('governance_version')
      .select(['content_kind', 'content_key'])
      .where('hospital_id', '=', hospitalId)
      .where('state', '=', 'PUBLISHED')
      .execute();

    const live = new Set(published.map((p) => `${p.content_kind}:${p.content_key}`));
    const missing: { kind: string; key: string; why: string }[] = [];

    for (const required of REQUIRED_CONTENT) {
      for (const language of languages) {
        const key = `${required.keyPrefix}${language.language_tag}`;
        if (!live.has(`${required.kind}:${key}`)) {
          missing.push({ kind: required.kind, key, why: required.why });
        }
      }
    }
    return missing;
  }
}
