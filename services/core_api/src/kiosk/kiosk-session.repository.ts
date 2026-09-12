import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { KioskSessionState, SessionEndReason } from '@medikiosk/api-contracts';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import type { KioskSessionRow } from '../db/database.types';
import { withSerializableRetry, type DbExecutor } from '../db/transaction';
import { kioskSessionMachine } from '../state-machines';
import { AuditRepository } from '../audit/audit.repository';

/** End reason -> terminal state. COMPLETED and EXIT both mean the patient left. */
const TERMINAL_STATE: Readonly<Record<SessionEndReason, KioskSessionState>> = {
  EXIT: 'EXITED',
  COMPLETED: 'EXITED',
  TIMEOUT: 'EXPIRED',
  ERROR: 'EXITED',
};

@Injectable()
export class KioskSessionRepository {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditRepository,
  ) {}

  async start(
    deviceId: string,
    deviceCode: string,
    correlationId: string,
  ): Promise<KioskSessionRow> {
    return withSerializableRetry(this.db, async (trx) => {
      const row = await trx
        .insertInto('kiosk_session')
        .values({ kiosk_device_id: deviceId, state: 'CREATED' })
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.audit.append(
        {
          actorId: `kiosk:${deviceCode}`,
          actorRole: 'KIOSK',
          action: 'SESSION_STARTED',
          entityType: 'kiosk_session',
          entityId: row.id,
          correlationId,
        },
        trx,
      );

      return row;
    });
  }

  async findById(id: string, executor: DbExecutor = this.db): Promise<KioskSessionRow | undefined> {
    return executor.selectFrom('kiosk_session').selectAll().where('id', '=', id).executeTakeFirst();
  }

  /** Records activity, resetting the inactivity window. Only meaningful while open. */
  async touch(id: string): Promise<KioskSessionRow | undefined> {
    return this.db
      .updateTable('kiosk_session')
      .set({ last_activity_at: sql<Date>`now()` })
      .where('id', '=', id)
      .where('ended_at', 'is', null)
      .returningAll()
      .executeTakeFirst();
  }

  /** Advances the session, refusing any transition the machine does not permit. */
  async transition(
    id: string,
    to: KioskSessionState,
    patch: Record<string, unknown> = {},
  ): Promise<KioskSessionRow> {
    return withSerializableRetry(this.db, async (trx) => {
      const current = await trx
        .selectFrom('kiosk_session')
        .selectAll()
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirstOrThrow();

      kioskSessionMachine.assertTransition(current.state, to);

      return trx
        .updateTable('kiosk_session')
        .set({ state: to, last_activity_at: sql<Date>`now()`, ...patch } as never)
        .where('id', '=', id)
        .where('version', '=', current.version)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  /**
   * Ends a session and records that the client wiped it.
   *
   * `wiped_at` is set in the same statement as the terminal state because the
   * `kiosk_session_ended_is_wiped` constraint will not accept one without the other. A
   * client that ends a session without attesting to the wipe therefore fails loudly here
   * rather than quietly leaving a closed session that was never cleared.
   *
   * Idempotent: a kiosk that times out locally and then also sends an explicit exit gets
   * the already-ended row back instead of an error.
   */
  async end(
    id: string,
    reason: SessionEndReason,
    deviceCode: string,
    correlationId: string,
  ): Promise<KioskSessionRow> {
    return withSerializableRetry(this.db, async (trx) => {
      const current = await trx
        .selectFrom('kiosk_session')
        .selectAll()
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirstOrThrow();

      if (current.ended_at !== null) return current;

      const target = TERMINAL_STATE[reason];
      kioskSessionMachine.assertTransition(current.state, target);

      const now = new Date();
      const row = await trx
        .updateTable('kiosk_session')
        .set({
          state: target,
          ended_at: now,
          wiped_at: now,
          // A finished session holds no patient linkage. Even though nothing clinical is
          // stored on this row, dropping the references means a closed session cannot be
          // used to associate a kiosk with a patient after the fact.
          patient_id: null,
          pre_checkin_id: null,
          language_tag: null,
        })
        .where('id', '=', id)
        .where('version', '=', current.version)
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.audit.append(
        {
          actorId: `kiosk:${deviceCode}`,
          actorRole: 'KIOSK',
          // A non-clinical termination event: reason and timing only, no patient data.
          action: `SESSION_ENDED_${reason}`,
          entityType: 'kiosk_session',
          entityId: id,
          correlationId,
          detail: { reason, previousState: current.state },
        },
        trx,
      );

      return row;
    });
  }

  /**
   * Expires sessions abandoned beyond the inactivity window.
   *
   * A patient who walks away is the normal case, not an edge case, so this sweep is what
   * actually guarantees no session stays open holding a screen. It runs server-side in
   * addition to the client's own timer, because a kiosk that crashed or lost power never
   * gets to run its timer at all.
   */
  async expireAbandoned(inactivitySeconds: number): Promise<number> {
    const result = await this.db
      .updateTable('kiosk_session')
      .set({ state: 'EXPIRED', ended_at: sql<Date>`now()`, wiped_at: sql<Date>`now()` })
      .where('ended_at', 'is', null)
      .where(
        'last_activity_at',
        '<',
        sql<Date>`now() - make_interval(secs => ${inactivitySeconds})`,
      )
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }
}
