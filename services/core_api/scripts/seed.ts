/**
 * Development seed: one hospital, one branch, one AYUSH department, three kiosks.
 *
 * This mirrors the recommended initial deployment — a single OPD, a single AYUSH system
 * and one or two validated languages. It is configuration, not test fixtures: the same
 * shape a real hospital would be onboarded with, so the local stack exercises the real
 * config path rather than a simplified one.
 *
 * Refuses to run against production. Idempotent, so re-seeding is safe.
 */
import { readFileSync } from 'node:fs';
import { findLanguage } from '@medikiosk/terminology';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { Database } from '../src/db/database.types';

/**
 * Languages this seed makes offerable: a complete shell translation AND a consent notice
 * to publish. Both are placeholders; the notice says so in its own first line and the
 * approval record reads NOT_A_REAL_APPROVAL.
 */
/**
 * Whether this content key already has something PUBLISHED for this hospital.
 *
 * Migration 0020 added `governance_version_one_published`: one live version per content
 * key, which is the constraint that makes "which questionnaire did this patient answer?"
 * answerable. The seed's ON CONFLICT is keyed on the semver, so re-seeding a database that
 * was seeded under an OLDER version number inserts a second PUBLISHED row and trips it.
 *
 * Skipping is the right behaviour rather than replacing: a published version is governed
 * content, and a seed script must never quietly retire one. If the placeholder needs
 * replacing, that happens through the governance console with a recorded transition.
 */
async function alreadyPublished(
  trx: Kysely<Database>,
  hospitalId: string,
  contentKind: 'CONSENT_NOTICE' | 'QUESTIONNAIRE',
  contentKey: string,
): Promise<boolean> {
  const existing = await trx
    .selectFrom('governance_version')
    .select('id')
    .where('hospital_id', '=', hospitalId)
    .where('content_kind', '=', contentKind)
    .where('content_key', '=', contentKey)
    .where('state', 'in', ['PUBLISHED', 'CANARY'])
    .executeTakeFirst();
  return existing !== undefined;
}

/** The AYUSH systems with an authored intake module. Keys match `ayushModuleKey`. */
const AYUSH_MODULES = [
  'ayurveda',
  'unani',
  'siddha',
  'yoga-naturopathy',
  'sowa-rigpa',
  'homoeopathy',
] as const;

const OFFERED_LANGUAGES = [
  'en',
  'hi',
  'as',
  'bn',
  'gu',
  'kn',
  'ml',
  'mr',
  'ne',
  'or',
  'pa',
  'ta',
  'te',
  'ur',
] as const;

const HOSPITAL_CODE = 'HOSP-001';

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is required');
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('seed refuses to run with NODE_ENV=production');
  }

  const pool = new Pool({ connectionString });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

  try {
    await db.transaction().execute(async (trx) => {
      const hospital = await trx
        .insertInto('hospital')
        .values({
          code: HOSPITAL_CODE,
          name: 'Government AYUSH Hospital',
          // ABHA stays off until the hospital has explicitly approved the integration.
          abha_enabled: false,
        })
        .onConflict((oc) => oc.column('code').doUpdateSet({ name: 'Government AYUSH Hospital' }))
        .returningAll()
        .executeTakeFirstOrThrow();

      const branch = await trx
        .insertInto('branch')
        .values({ hospital_id: hospital.id, code: 'MAIN', name: 'Main Campus' })
        .onConflict((oc) =>
          oc.columns(['hospital_id', 'code']).doUpdateSet({ name: 'Main Campus' }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();

      // Three enabled departments in development, so the department and AYUSH pickers are
      // actually reachable. With one enabled department the kiosk correctly skips both
      // screens — a single clinic needs no choosing — which made two working features look
      // like missing ones.
      //
      // A real hospital enables the departments it staffs. That is the point of the flag,
      // and MEDIKIOSK_SEED_SINGLE_DEPARTMENT=1 puts it back to one for testing the
      // skip-the-picker path.
      const singleDepartment = process.env['MEDIKIOSK_SEED_SINGLE_DEPARTMENT'] === '1';
      const departments = [
        { code: 'AYU-OPD', name: 'Ayurveda OPD', ayush_system: 'AYURVEDA' as const, enabled: true },
        {
          code: 'UNA-OPD',
          name: 'Unani OPD',
          ayush_system: 'UNANI' as const,
          enabled: !singleDepartment,
        },
        {
          code: 'SID-OPD',
          name: 'Siddha OPD',
          ayush_system: 'SIDDHA' as const,
          enabled: !singleDepartment,
        },
      ];
      for (const dept of departments) {
        await trx
          .insertInto('department')
          .values({ branch_id: branch.id, ...dept })
          .onConflict((oc) =>
            oc.columns(['branch_id', 'code']).doUpdateSet({ enabled: dept.enabled }),
          )
          .execute();
      }

      // Every language whose shell strings are complete AND which has a placeholder consent
      // notice to publish. The kiosk shows a language only when both hold, so this list and
      // NOTICE_LANGUAGES below have to agree — hence one constant driving both.
      //
      // `clinically_reviewed` is true here because these are DEVELOPMENT seeds against
      // placeholder notices that say so in their own first line. A real hospital sets this
      // flag only after a practitioner has approved the content in that language, which is
      // why the flag exists separately from the language being configured at all.
      //
      // Sanskrit is seeded as configured-but-unreviewed, so the kiosk's review gate is still
      // exercised locally: it must appear in the config table and NOT on the kiosk.
      const languages = [
        ...OFFERED_LANGUAGES.map((language_tag) => ({
          language_tag,
          // The label is a fallback only. The kiosk takes the endonym from the canonical
          // registry, so a hospital cannot mislabel a language for its patients.
          label: findLanguage(language_tag)?.endonym ?? language_tag,
          clinically_reviewed: true,
          audio_available: false,
        })),
        {
          language_tag: 'sa',
          label: findLanguage('sa')?.endonym ?? 'sa',
          clinically_reviewed: false,
          audio_available: false,
        },
      ];
      for (const lang of languages) {
        await trx
          .insertInto('hospital_language')
          .values({ hospital_id: hospital.id, ...lang })
          .onConflict((oc) =>
            oc
              .columns(['hospital_id', 'language_tag'])
              .doUpdateSet({ clinically_reviewed: lang.clinically_reviewed }),
          )
          .execute();
      }

      for (const code of ['MK-OPD-01', 'MK-OPD-02', 'MK-OPD-03']) {
        await trx
          .insertInto('kiosk_device')
          .values({ branch_id: branch.id, code, enabled: true })
          .onConflict((oc) => oc.column('code').doUpdateSet({ enabled: true }))
          .execute();
      }

      // Consent notices, published per language.
      //
      // The wording is an explicit placeholder that says so in its own first line. It
      // exists so the consent flow has a real governed version to reference end to end;
      // it must be replaced through the governance console, with named clinical and legal
      // approval, before any real patient is asked to agree to it. The seeded approval is
      // recorded as SEED-PLACEHOLDER precisely so it cannot be mistaken for a sign-off.
      // The common clinical core.
      //
      // The STRUCTURE follows the specification; not a phrase of it has been reviewed by
      // a practitioner. It is published so the engine can be exercised end to end, and
      // its version says `-placeholder` precisely so it cannot be mistaken for approved
      // clinical content. Phase 14 replaces it through the governance console, with named
      // practitioner, safety and translation approvals.
      //
      // Only English: publishing an unreviewed translation of clinical questions would be
      // worse than offering none, so Hindi intake is unavailable until it is translated
      // and reviewed.
      if (!(await alreadyPublished(trx, hospital.id, 'QUESTIONNAIRE', 'common-core/en'))) {
        const payload: unknown = JSON.parse(
          readFileSync(
            resolve(__dirname, '../../../infra/seed-content/questionnaire.common-core.en.json'),
            'utf8',
          ),
        );

        await trx
          .insertInto('governance_version')
          .values({
            hospital_id: hospital.id,
            content_kind: 'QUESTIONNAIRE',
            content_key: 'common-core/en',
            semver: '0.1.0-placeholder',
            state: 'PUBLISHED',
            published_by_user_id: 'SEED',
            published_at: new Date(),
            payload: JSON.stringify(payload),
            author_actor_id: 'SEED',
            approvals: JSON.stringify([
              {
                by: 'SEED-PLACEHOLDER',
                role: 'NOT_A_REAL_APPROVAL',
                at: new Date().toISOString(),
              },
            ]),
            effective_from: new Date(),
          })
          .onConflict((oc) =>
            oc.columns(['hospital_id', 'content_kind', 'content_key', 'semver']).doNothing(),
          )
          .execute();
      }

      // A demonstrable existing patient.
      //
      // Without one, "Existing Patient Check-in" cannot succeed at all: a mobile number is
      // MODERATE strength and the server will not release a record on it, so the only
      // working route is a UHID with a date of birth — and no seeded patient had either.
      // The path looked broken when it was simply unreachable.
      {
        const existing = await trx
          .insertInto('patient')
          .values({
            hospital_id: hospital.id,
            full_name: 'Demo Patient',
            date_of_birth: new Date('1978-04-12'),
            sex: 'FEMALE',
            mobile: '9000000001',
            provisional: false,
          })
          .onConflict((oc) => oc.doNothing())
          .returningAll()
          .executeTakeFirst();

        if (existing) {
          await trx
            .insertInto('patient_identifier')
            .values({
              patient_id: existing.id,
              type: 'UHID',
              value: 'UH00012345',
              issued_by: hospital.id,
            })
            .onConflict((oc) => oc.doNothing())
            .execute();
        }
      }

      // The six AYUSH intake modules.
      //
      // Authored as DRAFTS and published only so the kiosk can compose and serve them —
      // their semver says `-draft` and their approvals array is empty, which is what
      // `governance/unversioned` and the readiness tool read. They hold patient-reported
      // symptom questions only; the constitutional instruments of each system (Prakriti,
      // Vikriti, Mizaj and their equivalents) are deliberately absent and remain
      // AWAITING_AUTHORSHIP, because a plausible-looking version of a classification tool
      // is worse than none.
      for (const system of AYUSH_MODULES) {
        const contentKey = `${system}/en`;
        if (await alreadyPublished(trx, hospital.id, 'AYUSH_MODULE', contentKey)) continue;

        const payload: unknown = JSON.parse(
          readFileSync(
            resolve(__dirname, `../../../infra/seed-content/ayush-module.${system}.en.json`),
            'utf8',
          ),
        );

        await trx
          .insertInto('governance_version')
          .values({
            hospital_id: hospital.id,
            content_kind: 'AYUSH_MODULE',
            content_key: contentKey,
            semver: '0.1.0-draft',
            // DRAFT, not PUBLISHED, and the database is what decides that:
            // `governance_version_ayush_approval` requires four approvals before an AYUSH
            // module can go live. Writing four names nobody gave would be the one thing
            // this whole architecture exists to prevent, so the modules land in the
            // governance console as drafts and a practitioner of each system takes them
            // from there. Until then the kiosk serves the common core alone, which is the
            // correct behaviour rather than a limitation.
            state: 'DRAFT',
            published_by_user_id: null,
            published_at: null,
            payload: JSON.stringify(payload),
            author_actor_id: 'SEED',
            approvals: JSON.stringify([]),
            effective_from: null,
          })
          .onConflict((oc) =>
            oc.columns(['hospital_id', 'content_kind', 'content_key', 'semver']).doNothing(),
          )
          .execute();
      }

      for (const language of OFFERED_LANGUAGES) {
        const contentKey = `consent-notice/${language}`;
        if (await alreadyPublished(trx, hospital.id, 'CONSENT_NOTICE', contentKey)) continue;

        const payload: unknown = JSON.parse(
          readFileSync(
            resolve(__dirname, `../../../infra/seed-content/consent-notice.${language}.json`),
            'utf8',
          ),
        );

        await trx
          .insertInto('governance_version')
          .values({
            hospital_id: hospital.id,
            content_kind: 'CONSENT_NOTICE',
            content_key: contentKey,
            semver: '1.0.0',
            state: 'PUBLISHED',
            published_by_user_id: 'SEED',
            published_at: new Date(),
            payload: JSON.stringify(payload),
            author_actor_id: 'SEED',
            approvals: JSON.stringify([
              { by: 'SEED-PLACEHOLDER', role: 'NOT_A_REAL_APPROVAL', at: new Date().toISOString() },
            ]),
            effective_from: new Date(),
          })
          .onConflict((oc) =>
            oc.columns(['hospital_id', 'content_kind', 'content_key', 'semver']).doNothing(),
          )
          .execute();
      }
    });

    process.stdout.write(
      `seeded ${HOSPITAL_CODE}: 1 branch, 3 departments, ${OFFERED_LANGUAGES.length + 1} languages ` +
        `(${OFFERED_LANGUAGES.length} offerable, 1 unreviewed), 3 kiosks, ` +
        `${OFFERED_LANGUAGES.length} placeholder consent notices, 1 placeholder questionnaire, ` +
        `${AYUSH_MODULES.length} AYUSH modules awaiting clinical approval, ` +
        '1 demo patient (UHID UH00012345, born 1978-04-12)\n',
    );
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
