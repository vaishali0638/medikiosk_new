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
import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { Database } from '../src/db/database.types';

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

      // One AYUSH system for the pilot; the rest exist as config but stay disabled.
      const departments = [
        { code: 'AYU-OPD', name: 'Ayurveda OPD', ayush_system: 'AYURVEDA' as const, enabled: true },
        { code: 'UNA-OPD', name: 'Unani OPD', ayush_system: 'UNANI' as const, enabled: false },
        { code: 'SID-OPD', name: 'Siddha OPD', ayush_system: 'SIDDHA' as const, enabled: false },
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

      // Only clinically reviewed languages are offered to patients. Tamil is seeded as
      // configured-but-unreviewed so the kiosk's review gate is exercised locally.
      const languages = [
        { language_tag: 'en', label: 'English', clinically_reviewed: true, audio_available: true },
        { language_tag: 'hi', label: 'हिन्दी', clinically_reviewed: true, audio_available: true },
        { language_tag: 'ta', label: 'தமிழ்', clinically_reviewed: false, audio_available: false },
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

      // A placeholder consent notice so the consent flow has a version to reference.
      // Real notice text is authored and approved through the governance console.
      await trx
        .insertInto('governance_version')
        .values({
          hospital_id: hospital.id,
          content_kind: 'TERMINOLOGY',
          content_key: 'consent-notice',
          semver: '1.0.0',
          state: 'PUBLISHED',
          payload: JSON.stringify({
            noticeVersion: 'v1.0',
            note: 'Placeholder. Requires hospital legal and clinical approval before pilot use.',
          }),
          author_actor_id: 'SEED',
          effective_from: new Date(),
        })
        .onConflict((oc) =>
          oc.columns(['hospital_id', 'content_kind', 'content_key', 'semver']).doNothing(),
        )
        .execute();
    });

    process.stdout.write(
      `seeded ${HOSPITAL_CODE}: 1 branch, 3 departments, 3 languages, 3 kiosks\n`,
    );
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
