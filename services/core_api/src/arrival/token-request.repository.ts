import { Inject, Injectable } from '@nestjs/common';
import type { TokenRequestState } from '@medikiosk/api-contracts';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import type { TokenRequestRow } from '../db/database.types';
import { withSerializableRetry, type DbExecutor } from '../db/transaction';
import { tokenRequestMachine } from '../state-machines';

export interface OpenTokenRequestInput {
  readonly preCheckinId: string;
  readonly kioskDeviceCode: string;
  readonly kioskDeviceId: string;
  readonly encounterId?: string | undefined;
}

export interface RecordIssuedInput {
  readonly idempotencyKey: string;
  readonly hisToken: string;
  readonly hisResponseRef?: string | undefined;
}

/** Builds the idempotency key. Derived, never client-supplied. */
export function tokenIdempotencyKey(kioskDeviceCode: string, preCheckinId: string): string {
  return `${kioskDeviceCode}-${preCheckinId}`;
}

@Injectable()
export class TokenRequestRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Opens a token request, or returns the existing one for the same key.
   *
   * Every retry path — a double tap, a kiosk reconnect, an HTTP timeout followed by a
   * client retry — derives the same `<kioskCode>-<preCheckinId>` key. The insert is an
   * upsert that does nothing on conflict, so concurrent callers converge on one row
   * instead of creating a second request that could earn a second token.
   */
  async open(input: OpenTokenRequestInput): Promise<{ row: TokenRequestRow; created: boolean }> {
    const key = tokenIdempotencyKey(input.kioskDeviceCode, input.preCheckinId);

    const inserted = await this.db
      .insertInto('token_request')
      .values({
        pre_checkin_id: input.preCheckinId,
        kiosk_device_id: input.kioskDeviceId,
        encounter_id: input.encounterId ?? null,
        idempotency_key: key,
        state: 'NOT_STARTED',
      })
      .onConflict((oc) => oc.column('idempotency_key').doNothing())
      .returningAll()
      .executeTakeFirst();

    if (inserted) return { row: inserted, created: true };

    const existing = await this.db
      .selectFrom('token_request')
      .selectAll()
      .where('idempotency_key', '=', key)
      .executeTakeFirstOrThrow();

    return { row: existing, created: false };
  }

  /** Moves NOT_STARTED/FAILED -> REQUESTED and counts the attempt. */
  async markRequested(idempotencyKey: string): Promise<TokenRequestRow> {
    return this.transition(idempotencyKey, 'REQUESTED', (current) => ({
      state: 'REQUESTED' as const,
      requested_at: new Date(),
      attempt_count: current.attempt_count + 1,
    }));
  }

  async markAcknowledged(idempotencyKey: string): Promise<TokenRequestRow> {
    return this.transition(idempotencyKey, 'ACKNOWLEDGED', () => ({
      state: 'ACKNOWLEDGED' as const,
      acknowledged_at: new Date(),
    }));
  }

  /**
   * Records the token the HIS issued.
   *
   * If this request is already ISSUED the stored token is returned unchanged rather than
   * overwritten. That is the safety property: once the hospital has given this visit a
   * token, no later call — a duplicated response, a replayed webhook — can replace it.
   */
  async recordIssued(input: RecordIssuedInput): Promise<TokenRequestRow> {
    return withSerializableRetry(this.db, async (trx) => {
      const current = await trx
        .selectFrom('token_request')
        .selectAll()
        .where('idempotency_key', '=', input.idempotencyKey)
        .forUpdate()
        .executeTakeFirstOrThrow();

      if (current.state === 'ISSUED') return current;

      tokenRequestMachine.assertTransition(current.state, 'ISSUED');

      return trx
        .updateTable('token_request')
        .set({
          state: 'ISSUED',
          his_token: input.hisToken,
          his_response_ref: input.hisResponseRef ?? null,
          issued_at: new Date(),
          last_error_code: null,
        })
        .where('id', '=', current.id)
        .where('version', '=', current.version)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  /** The HIS definitively refused. A retry under the same key is safe from here. */
  async markFailed(idempotencyKey: string, errorCode: string): Promise<TokenRequestRow> {
    return this.transition(idempotencyKey, 'FAILED', () => ({
      state: 'FAILED' as const,
      last_error_code: errorCode,
    }));
  }

  /**
   * We do not know whether the HIS acted. This is terminal for the automated path: a
   * human checks the HIS and records the outcome. The system never resolves the
   * ambiguity by requesting another token.
   */
  async markReconciliationRequired(idempotencyKey: string, note: string): Promise<TokenRequestRow> {
    return this.transition(idempotencyKey, 'UNKNOWN_RECONCILIATION_REQUIRED', () => ({
      state: 'UNKNOWN_RECONCILIATION_REQUIRED' as const,
      reconciliation_note: note,
    }));
  }

  async findByKey(
    idempotencyKey: string,
    executor: DbExecutor = this.db,
  ): Promise<TokenRequestRow | undefined> {
    return executor
      .selectFrom('token_request')
      .selectAll()
      .where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirst();
  }

  /** Everything awaiting human reconciliation, oldest first. */
  async listAwaitingReconciliation(executor: DbExecutor = this.db): Promise<TokenRequestRow[]> {
    return executor
      .selectFrom('token_request')
      .selectAll()
      .where('state', '=', 'UNKNOWN_RECONCILIATION_REQUIRED')
      .orderBy('created_at', 'asc')
      .execute();
  }

  /** Reads, guards the transition against the machine, then writes — all under one lock. */
  private async transition(
    idempotencyKey: string,
    to: TokenRequestState,
    patch: (current: TokenRequestRow) => Record<string, unknown>,
  ): Promise<TokenRequestRow> {
    return withSerializableRetry(this.db, async (trx) => {
      const current = await trx
        .selectFrom('token_request')
        .selectAll()
        .where('idempotency_key', '=', idempotencyKey)
        .forUpdate()
        .executeTakeFirstOrThrow();

      tokenRequestMachine.assertTransition(current.state, to);

      return trx
        .updateTable('token_request')
        .set(patch(current) as never)
        .where('id', '=', current.id)
        .where('version', '=', current.version)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }
}
