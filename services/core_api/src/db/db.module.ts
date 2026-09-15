import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Global, Inject, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { Env } from '../config/env';
import { createDb, createPool, registerEnumArrayParsers, type Db } from './db.provider';

export const DB = Symbol('MEDIKIOSK_DB');
export const DB_POOL = Symbol('MEDIKIOSK_DB_POOL');

/**
 * Whether to open the connection with TLS.
 *
 * Derived from the HOST, not from NODE_ENV. Tying it to NODE_ENV meant a developer
 * pointing at a hosted database — Supabase, or any managed Postgres — got a plaintext
 * connection attempt that the server refuses, with an error that does not mention TLS.
 * Worse is the case where it does not refuse: NODE_ENV is one careless deploy away from
 * "development", and the outcome there is patient data crossing a network unencrypted.
 *
 * So: anything that is not plainly local gets TLS, and an explicit DB_SSL overrides the
 * guess for the awkward cases — a local instance with a certificate, or a Postgres
 * reachable over a private network that terminates TLS elsewhere.
 */
export function requiresTls(connectionString: string, override?: boolean): boolean {
  if (override !== undefined) return override;

  try {
    const host = new URL(connectionString).hostname;
    return !(host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '');
  } catch {
    // An unparseable URL is not a licence to send credentials in the clear.
    return true;
  }
}

/**
 * Reads a CA bundle from disk, if one is configured.
 *
 * A path rather than the PEM inline: certificates are long, multi-line and public, and
 * pasting one into an environment variable is how a .env stops being readable.
 */
export function readCaCertificate(path?: string): string | undefined {
  if (!path) return undefined;

  // Relative to the working directory OR to the repository root. The API is started from
  // both — `npm run start:dev -w @medikiosk/core-api` runs inside the service — and a
  // config value that works from one directory and not the other is a trap, especially
  // for one whose absence means an unverified connection.
  const candidates = [resolve(path), resolve(__dirname, '../../../..', path)];
  const found = candidates.find((candidate) => existsSync(candidate));

  if (!found) {
    throw new Error(`DB_CA_CERT_PATH points at nothing. Tried: ${candidates.join(', ')}`);
  }
  return readFileSync(found, 'utf8');
}

@Global()
@Module({
  providers: [
    {
      provide: DB_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Pool => {
        const connectionString = config.get('DATABASE_URL', { infer: true });
        if (!connectionString) {
          throw new Error('DATABASE_URL is required to start the core API');
        }
        return createPool({
          connectionString,
          ssl: requiresTls(connectionString, config.get('DB_SSL', { infer: true })),
          caCertificate: readCaCertificate(config.get('DB_CA_CERT_PATH', { infer: true })),
          maxConnections: config.get('DB_MAX_CONNECTIONS', { infer: true }),
        });
      },
    },
    {
      provide: DB,
      inject: [DB_POOL],
      useFactory: (pool: Pool): Db => createDb(pool),
    },
  ],
  exports: [DB, DB_POOL],
})
export class DbModule implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /** Enum array types get dynamic OIDs, so their parsers can only be registered once a
   *  connection exists and the schema is known. */
  async onModuleInit(): Promise<void> {
    await registerEnumArrayParsers(this.pool);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
