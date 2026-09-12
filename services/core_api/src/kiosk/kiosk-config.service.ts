import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AyushSystem, KioskConfigResponse } from '@medikiosk/api-contracts';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import type { Env } from '../config/env';
import { ConsentNoticeService } from '../consent/consent-notice.service';
import type { KioskContext } from './kiosk-device.guard';

/** Fallback session timings if the hospital has not overridden them. Seconds. */
const DEFAULT_INACTIVITY_WARNING_SECONDS = 90;
const DEFAULT_INACTIVITY_WIPE_SECONDS = 30;

@Injectable()
export class KioskConfigService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService<Env, true>,
    private readonly notices: ConsentNoticeService,
  ) {}

  /**
   * Builds the configuration a kiosk boots against.
   *
   * Everything a patient can be offered is filtered here rather than in the client:
   *
   * - A language is offered only if it is BOTH clinically reviewed AND has a published
   *   consent notice. Reviewed labels with no notice would walk a patient to the consent
   *   screen and strand them, since there is deliberately no cross-language fallback for
   *   the wording someone is asked to agree to.
   * - Only enabled departments are returned, and the AYUSH list is derived from them,
   *   so a system the hospital has not configured cannot appear.
   * - Feature flags come from the server. A disabled feature must not render at all,
   *   and a kiosk that decided this locally could drift from what the hospital approved.
   */
  async build(kiosk: KioskContext): Promise<KioskConfigResponse> {
    const hospital = await this.db
      .selectFrom('hospital')
      .select(['id', 'code', 'name', 'abha_enabled'])
      .where('id', '=', kiosk.hospitalId)
      .executeTakeFirstOrThrow();

    const branch = await this.db
      .selectFrom('branch')
      .select(['id', 'code'])
      .where('id', '=', kiosk.branchId)
      .executeTakeFirstOrThrow();

    const languageRows = await this.db
      .selectFrom('hospital_language')
      .select(['language_tag', 'label', 'clinically_reviewed', 'audio_available'])
      .where('hospital_id', '=', hospital.id)
      .where('clinically_reviewed', '=', true)
      .orderBy('language_tag', 'asc')
      .execute();

    const departmentRows = await this.db
      .selectFrom('department')
      .select(['code', 'name', 'ayush_system'])
      .where('branch_id', '=', branch.id)
      .where('enabled', '=', true)
      .orderBy('name', 'asc')
      .execute();

    const noticeLanguages = new Set(await this.notices.publishedLanguages(hospital.id));
    const offerable = languageRows.filter((row) => noticeLanguages.has(row.language_tag));

    const ayushSystems = [
      ...new Set(
        departmentRows.map((d) => d.ayush_system).filter((s): s is AyushSystem => s !== null),
      ),
    ];

    return {
      hospitalId: hospital.code,
      hospitalName: hospital.name,
      branchId: branch.code,
      kioskId: kiosk.deviceCode,
      languages: offerable.map((row) => ({
        tag: row.language_tag,
        label: row.label,
        clinicallyReviewed: row.clinically_reviewed,
        audioAvailable: row.audio_available,
      })),
      departments: departmentRows.map((row) => ({
        departmentId: row.code,
        name: row.name,
        ...(row.ayush_system ? { ayushSystem: row.ayush_system } : {}),
      })),
      ayushSystems,
      features: {
        // ABHA needs BOTH the deployment flag and the hospital's own approval. Either
        // one alone is not consent to run an identity integration on real patients.
        abha: this.config.get('FEATURE_ABHA', { infer: true }) === true && hospital.abha_enabled,
        aiSummary: this.config.get('FEATURE_AI_SUMMARY', { infer: true }) === true,
        ocr: this.config.get('FEATURE_OCR', { infer: true }) === true,
        redFlags: this.config.get('FEATURE_RED_FLAGS', { infer: true }) === true,
        voiceIntake: this.config.get('FEATURE_VOICE_INTAKE', { infer: true }) === true,
      },
      contentVersions: {
        // Phase 8/9 publish real questionnaire and translation releases; until then the
        // kiosk is told 0.0.0, which is not a valid published version and so cannot be
        // mistaken for approved clinical content.
        questionnaire: '0.0.0',
        translations: '0.0.0',
        // Notices are versioned per language, so the config reports which languages have
        // one rather than a single version that could not describe all of them.
        consentNotice:
          offerable.length > 0 ? offerable.map((r) => r.language_tag).join(',') : 'UNPUBLISHED',
      },
      session: {
        inactivityWarningSeconds: DEFAULT_INACTIVITY_WARNING_SECONDS,
        inactivityWipeSeconds: DEFAULT_INACTIVITY_WIPE_SECONDS,
      },
    };
  }

  get inactivityWarningSeconds(): number {
    return DEFAULT_INACTIVITY_WARNING_SECONDS;
  }

  get inactivityWipeSeconds(): number {
    return DEFAULT_INACTIVITY_WIPE_SECONDS;
  }

  get totalInactivitySeconds(): number {
    return DEFAULT_INACTIVITY_WARNING_SECONDS + DEFAULT_INACTIVITY_WIPE_SECONDS;
  }
}
