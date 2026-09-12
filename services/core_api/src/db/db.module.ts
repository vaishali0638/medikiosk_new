import { Global, Inject, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { Env } from '../config/env';
import { createDb, createPool, registerEnumArrayParsers, type Db } from './db.provider';

export const DB = Symbol('MEDIKIOSK_DB');
export const DB_POOL = Symbol('MEDIKIOSK_DB_POOL');

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
          ssl: config.get('NODE_ENV', { infer: true }) === 'production',
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
