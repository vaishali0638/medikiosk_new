/**
 * Verifies a Supabase project is ready to be MediKiosk's database and object store.
 *
 * Written because the alternative is discovering each of these one at a time, at a kiosk,
 * from an error that does not name the cause. Every check here corresponds to a specific
 * way a Supabase-backed deployment fails in practice.
 *
 *   npm run supabase:check -w @medikiosk/core-api
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

for (const candidate of ['.env', resolve(__dirname, '../../../.env')]) {
  if (!existsSync(candidate)) continue;
  for (const l of readFileSync(candidate, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
    if (match?.[1] && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2]?.replace(/^"|"$/g, '');
    }
  }
  break;
}

const line = (ok: boolean, what: string, detail = ''): void => {
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${what}${detail ? `  — ${detail}` : ''}\n`);
};

let failures = 0;
const fail = (what: string, detail: string): void => {
  failures += 1;
  line(false, what, detail);
};

async function checkDatabase(url: string): Promise<void> {
  // Same two-place resolution as the API; see readCaCertificate.
  const configured = process.env['DB_CA_CERT_PATH'];
  const caPath = configured
    ? [resolve(configured), resolve(__dirname, '../../..', configured)].find((candidate) =>
        existsSync(candidate),
      )
    : undefined;
  if (configured && !caPath) fail('DB_CA_CERT_PATH points at nothing', configured);
  const host = new URL(url).hostname;
  const port = new URL(url).port || '5432';

  // Supabase's transaction pooler (Supavisor, port 6543) hands a different connection to
  // every statement. Migrations take advisory locks and run DDL across statements, so they
  // must use the DIRECT connection. Getting this wrong fails in a way that reads like a
  // permissions problem.
  if (port === '6543') {
    fail(
      'connection is the transaction pooler (:6543)',
      'migrations need the direct connection (:5432). Use the pooler for the API only.',
    );
  } else {
    line(true, `connection is direct or session-mode (:${port})`);
  }

  const pool = new Pool({
    connectionString: url,
    ssl:
      host.endsWith('.supabase.co') || host.endsWith('.supabase.com')
        ? {
            rejectUnauthorized: true,
            // The same CA the API uses. Checking with a weaker setting than the real thing
            // would make this script report a connection that does not actually work.
            ...(caPath ? { ca: readFileSync(caPath, 'utf8') } : {}),
          }
        : undefined,
    connectionTimeoutMillis: 10_000,
    max: 2,
  });

  try {
    const { rows } = await pool.query<{ version: string; ssl: boolean | null }>(
      `SELECT version() AS version,
              (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl`,
    );
    const major = /PostgreSQL (\d+)/.exec(rows[0]?.version ?? '')?.[1];
    line(true, 'database reachable', `PostgreSQL ${major ?? '?'}`);

    if (Number(major) < 15) {
      fail('PostgreSQL is older than 15', 'the migrations use syntax that needs 15 or newer');
    }

    // TLS is not optional for patient health data crossing a network.
    if (rows[0]?.ssl === true) line(true, 'connection is encrypted');
    else if (host === 'localhost' || host === '127.0.0.1')
      line(true, 'local connection, TLS not required');
    else fail('connection is NOT encrypted', 'patient data would cross the network in the clear');

    const { rows: ext } = await pool.query<{ name: string }>(
      `SELECT extname AS name FROM pg_extension WHERE extname IN ('pgcrypto', 'uuid-ossp')`,
    );
    const names = ext.map((e) => e.name);
    // gen_random_uuid() is the default for every primary key in this schema. It is built in
    // from PostgreSQL 13, and pgcrypto provides it before that; Supabase enables it anyway.
    line(names.includes('pgcrypto'), 'pgcrypto available', names.join(', ') || 'none');

    const { rows: applied } = await pool
      .query<{ count: string }>(`SELECT count(*)::text AS count FROM schema_migrations`)
      .catch(() => ({ rows: [{ count: '0' }] }));
    const count = Number(applied[0]?.count ?? 0);
    if (count === 0) {
      line(true, 'schema not yet applied', 'run npm run migrate -w @medikiosk/core-api');
    } else {
      line(true, `schema applied`, `${count} migrations`);
    }

    const { rows: limits } = await pool.query<{ max: string; used: string }>(
      `SELECT current_setting('max_connections') AS max,
              (SELECT count(*)::text FROM pg_stat_activity) AS used`,
    );
    line(true, 'connection budget', `${limits[0]?.used} of ${limits[0]?.max} in use`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    if (message.includes('self-signed certificate')) {
      fail(
        'database TLS could not be verified',
        'Supabase signs with its own root — set DB_CA_CERT_PATH to ' +
          'infra/certs/supabase-prod-ca-2021.crt. See infra/certs/README.md. Do not ' +
          'disable verification.',
      );
    } else {
      fail('database unreachable', message);
    }
  } finally {
    await pool.end();
  }
}

async function checkStorage(url: string, key: string, bucket: string): Promise<void> {
  const base = url.replace(/\/$/, '');
  const headers = { authorization: `Bearer ${key}`, apikey: key };

  const response = await fetch(`${base}/storage/v1/bucket/${bucket}`, { headers }).catch(
    () => null,
  );

  if (!response) return fail('storage unreachable', `${base} did not answer`);
  if (response.status === 404) {
    return fail(`bucket "${bucket}" does not exist`, 'create it in the dashboard, private');
  }
  if (!response.ok) {
    return fail(
      `bucket "${bucket}" not readable (${response.status})`,
      'check the service-role key',
    );
  }

  const meta = (await response.json()) as { public?: boolean };
  if (meta.public === true) {
    return fail(
      `bucket "${bucket}" is PUBLIC`,
      'original medical documents must not be publicly readable',
    );
  }
  line(true, `bucket "${bucket}" exists and is private`);
}

async function main(): Promise<void> {
  process.stdout.write('\nSupabase readiness\n\n');

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    fail('DATABASE_URL is not set', 'point it at the Supabase direct connection string');
  } else {
    await checkDatabase(databaseUrl);
  }

  const supabaseUrl = process.env['SUPABASE_URL'];
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const bucket = process.env['SUPABASE_STORAGE_BUCKET'] ?? 'medikiosk-documents';

  // Storage only matters when documents are actually going there. Failing the whole check
  // over an unset key, while the adapter is pointed somewhere else, would train people to
  // ignore it.
  const storageInUse = process.env['OBJECT_STORE_ADAPTER'] === 'supabase';

  if (serviceKey?.startsWith('PASTE_')) {
    const say = storageInUse ? fail : (w: string, d: string) => line(true, w, d);
    say(
      'SUPABASE_SERVICE_ROLE_KEY is still the placeholder',
      'Project Settings → API → service_role',
    );
  } else if (!supabaseUrl || !serviceKey) {
    line(
      true,
      'storage not configured',
      'set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to use Supabase Storage for documents',
    );
  } else {
    await checkStorage(supabaseUrl, serviceKey, bucket);
  }

  process.stdout.write('\n');
  if (failures > 0) {
    process.stderr.write(
      `  ${failures} problem(s). Fix these before pointing the kiosk at it.\n\n`,
    );
    process.exit(1);
  }
  process.stdout.write('  Ready.\n\n');
}

void main();
