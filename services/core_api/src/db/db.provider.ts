import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types as pgTypes } from 'pg';
import { parse as parsePostgresArray } from 'postgres-array';
import type { Database } from './database.types';

/**
 * numeric/decimal arrives from pg as a string to avoid float precision loss. Confidence
 * scores are the only numerics in this schema and are bounded 0..1, so parsing them to a
 * number is safe and saves every call site from doing it.
 */
const PG_NUMERIC_OID = 1700;
pgTypes.setTypeParser(PG_NUMERIC_OID, (value: string) => Number.parseFloat(value));

/** bigint stays a string: audit_event.id and byte sizes can exceed Number.MAX_SAFE_INTEGER. */

/**
 * Teaches pg how to read arrays of our custom enum types.
 *
 * pg ships parsers keyed by OID, and every built-in array type has one. A user-defined
 * enum gets a dynamically assigned OID at CREATE TYPE time, so its array has no parser
 * and pg hands back the raw literal `{demographics,clinical-history}` instead of an
 * array. Left unfixed, `consent.data_categories` reads back as a string and every caller
 * silently gets the wrong type.
 *
 * Called once per pool during startup. Idempotent.
 */
export async function registerEnumArrayParsers(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ array_oid: string }>(
    `SELECT t.typarray::int AS array_oid
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typtype = 'e'
        AND n.nspname = 'public'
        AND t.typarray <> 0`,
  );

  for (const row of rows) {
    pgTypes.setTypeParser(Number(row.array_oid), (value: string) => parsePostgresArray(value));
  }
  return rows.length;
}

export interface DbConfig {
  readonly connectionString: string;
  /** PEM for a CA the provider signs with, when it is not a publicly trusted one. */
  readonly caCertificate?: string | undefined;
  readonly maxConnections?: number;
  /** Fail fast rather than queue behind an unhealthy database. */
  readonly connectionTimeoutMs?: number;
  readonly ssl?: boolean;
}

export function createPool(config: DbConfig): Pool {
  return new Pool({
    connectionString: config.connectionString,
    max: config.maxConnections ?? 10,
    connectionTimeoutMillis: config.connectionTimeoutMs ?? 5_000,
    // Sessions are short; releasing idle connections keeps the OPD-hours footprint small.
    idleTimeoutMillis: 30_000,
    ...(config.ssl
      ? {
          ssl: {
            rejectUnauthorized: true,
            // A managed provider frequently signs with its own root, which Node does not
            // trust — Supabase does, and the error reads "self-signed certificate in
            // certificate chain". The usual answer to that is rejectUnauthorized: false,
            // which does not fix it: the connection stays encrypted and stops being
            // authenticated, so anything able to intercept the network reads every patient
            // record on it. Trusting the one named CA keeps verification intact.
            ...(config.caCertificate ? { ca: config.caCertificate } : {}),
          },
        }
      : {}),
  });
}

export function createDb(pool: Pool): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

export type Db = Kysely<Database>;
