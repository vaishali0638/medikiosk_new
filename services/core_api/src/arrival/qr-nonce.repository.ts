import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import type { QrNonceRow } from '../db/database.types';
import { withSerializableRetry, type DbExecutor } from '../db/transaction';

export interface IssueNonceInput {
  readonly preCheckinId: string;
  readonly signingKeyId: string;
  readonly expiresAt: Date;
}

/** Why a nonce could not be consumed. Kept internal — the patient sees one neutral message. */
export type ConsumeFailureReason = 'NOT_FOUND' | 'ALREADY_CONSUMED' | 'EXPIRED' | 'REVOKED';

export type ConsumeResult =
  | { readonly ok: true; readonly nonce: QrNonceRow }
  | { readonly ok: false; readonly reason: ConsumeFailureReason };

@Injectable()
export class QrNonceRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Issues a fresh one-time nonce, retiring any live one for the same pre-check-in.
   *
   * Two valid codes for one visit must never circulate at once — a patient who reissues
   * and then finds the old screenshot would otherwise have two usable QRs. The partial
   * unique index `qr_nonce_one_live_per_precheckin` backs this up in the database, so
   * even a concurrent double-issue fails rather than producing a second live code.
   */
  async issue(input: IssueNonceInput): Promise<QrNonceRow> {
    return withSerializableRetry(this.db, async (trx) => {
      await trx
        .updateTable('qr_nonce')
        .set({ state: 'REVOKED' })
        .where('pre_checkin_id', '=', input.preCheckinId)
        .where('state', '=', 'ISSUED')
        .execute();

      return trx
        .insertInto('qr_nonce')
        .values({
          pre_checkin_id: input.preCheckinId,
          nonce: randomUUID(),
          signing_key_id: input.signingKeyId,
          expires_at: input.expiresAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  /**
   * Consumes a nonce, atomically.
   *
   * This is deliberately a single conditional UPDATE rather than a read-then-write. Two
   * kiosks scanning the same code at the same instant both run this statement; PostgreSQL
   * serialises them on the row, the first sees `state = 'ISSUED'` and wins, and the second
   * matches no row and is told the code is spent. A check-then-act version would let both
   * through, which is exactly the QR-replay hole the design has to close.
   *
   * Expiry is evaluated with the database clock, so a kiosk with a wrong system time
   * cannot extend the life of a code.
   */
  async consume(
    nonce: string,
    kioskDeviceId: string,
    executor: DbExecutor = this.db,
  ): Promise<ConsumeResult> {
    const consumed = await executor
      .updateTable('qr_nonce')
      .set({
        state: 'CONSUMED',
        consumed_at: new Date(),
        consumed_by_kiosk: kioskDeviceId,
      })
      .where('nonce', '=', nonce)
      .where('state', '=', 'ISSUED')
      .where('expires_at', '>', sql<Date>`now()`)
      .returningAll()
      .executeTakeFirst();

    if (consumed) return { ok: true, nonce: consumed };

    // The update matched nothing. Establish why, for the audit log only.
    const existing = await executor
      .selectFrom('qr_nonce')
      .selectAll()
      .where('nonce', '=', nonce)
      .executeTakeFirst();

    if (!existing) return { ok: false, reason: 'NOT_FOUND' };
    if (existing.state === 'CONSUMED') return { ok: false, reason: 'ALREADY_CONSUMED' };
    if (existing.state === 'REVOKED') return { ok: false, reason: 'REVOKED' };
    return { ok: false, reason: 'EXPIRED' };
  }

  /** Marks lapsed nonces EXPIRED. Housekeeping; consumption already checks expiry itself. */
  async expireLapsed(executor: DbExecutor = this.db): Promise<number> {
    const result = await executor
      .updateTable('qr_nonce')
      .set({ state: 'EXPIRED' })
      .where('state', '=', 'ISSUED')
      .where('expires_at', '<=', sql<Date>`now()`)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async findByNonce(
    nonce: string,
    executor: DbExecutor = this.db,
  ): Promise<QrNonceRow | undefined> {
    return executor
      .selectFrom('qr_nonce')
      .selectAll()
      .where('nonce', '=', nonce)
      .executeTakeFirst();
  }
}
