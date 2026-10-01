/**
 * Drops and recreates the public schema, then re-runs every migration.
 *
 * Development and test only. It refuses to touch a production database, because the
 * whole point of migrations is that a production schema is never rebuilt from scratch.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { loadRepoEnv } from './load-env';

async function main(): Promise<void> {
  const from = loadRepoEnv();
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error(
      from
        ? `DATABASE_URL is required and ${from} does not set it`
        : 'DATABASE_URL is required, and there is no .env at the repository root',
    );
  }

  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('reset-database refuses to run with NODE_ENV=production');
  }
  if (!/medikiosk_(dev|test|ci)/.test(connectionString)) {
    throw new Error(
      'reset-database only targets a database named medikiosk_dev, medikiosk_test or medikiosk_ci',
    );
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }

  execFileSync(
    'npx',
    [
      'node-pg-migrate',
      'up',
      '-m',
      resolve(__dirname, '../../../infra/migrations'),
      '-j',
      'sql',
      '--migrations-table',
      'schema_migrations',
    ],
    { stdio: 'inherit', env: process.env },
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
