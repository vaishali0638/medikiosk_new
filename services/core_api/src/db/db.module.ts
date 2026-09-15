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
