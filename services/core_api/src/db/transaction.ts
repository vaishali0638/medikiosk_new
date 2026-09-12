import type { Transaction } from 'kysely';
import type { Database } from './database.types';
import type { Db } from './db.provider';

/** A handle that is either the pool or an open transaction. */
export type DbExecutor = Db | Transaction<Database>;

/**
 * Runs `work` inside a SERIALIZABLE transaction.
 *
 * Consent capture, arrival confirmation and token state changes all use this. They are
 * read-modify-write sequences whose correctness depends on no other session interleaving:
 * at READ COMMITTED, two concurrent kiosk scans could each read an unconsumed nonce
 * before either wrote. SERIALIZABLE makes the loser abort instead.
 */
export async function inSerializableTransaction<T>(
  db: Db,
  work: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return db.transaction().setIsolationLevel('serializable').execute(work);
}

/** PostgreSQL serialization failure. Safe to retry: nothing was committed. */
const SERIALIZATION_FAILURE = '40001';
/** Deadlock detected. Also safe to retry. */
const DEADLOCK_DETECTED = '40P01';

export function isRetryableTransactionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === SERIALIZATION_FAILURE || code === DEADLOCK_DETECTED;
}

/**
 * Retries a serializable transaction on serialization failure.
 *
 * Only conflicts are retried. A business-rule rejection — an already-consumed nonce, an
 * already-issued token — is not retried, because retrying it would be an attempt to get
 * a different answer to a question the database has already settled.
 */
export async function withSerializableRetry<T>(
  db: Db,
  work: (trx: Transaction<Database>) => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await inSerializableTransaction(db, work);
    } catch (error) {
      if (!isRetryableTransactionError(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}
