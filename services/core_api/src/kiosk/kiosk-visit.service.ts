import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import type { PreCheckinRow } from '../db/database.types';
import { withSerializableRetry } from '../db/transaction';
import { DomainError } from '../common/domain-error';
import { AuditRepository } from '../audit/audit.repository';
import { ConsentService } from '../consent/consent.service';
import { KioskSessionRepository } from './kiosk-session.repository';
import { preCheckinMachine } from '../state-machines';

export interface OpenVisitInput {
  readonly sessionId: string;
  readonly departmentCode: string;
  readonly hospitalId: string;
  readonly branchId: string;
  readonly correlationId: string;
  readonly actorId: string;
}

/**
 * The walk-in equivalent of a mobile pre-check-in.
 *
 * A patient who arrives with a QR already has a `pre_checkin` — it was created on their
 * phone. A patient who walks up to the kiosk has nothing, and every clinical surface
 * downstream (intake, documents, review, submission, draft) is keyed on a visit. So one is
 * opened here, at the kiosk, once identity is confirmed.
 *
 * The same row type is used deliberately rather than a parallel "kiosk visit" concept. A
 * clinician should not be able to tell from the record which door the patient came
 * through, and a second table would mean every downstream query needed two branches — the
 * kind of duplication where one branch quietly stops getting the safety checks.
 */
@Injectable()
export class KioskVisitService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly sessions: KioskSessionRepository,
    private readonly consents: ConsentService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Opens the visit for a confirmed patient.
   *
   * Idempotent by session: a kiosk that retries a timed-out request, or a patient who
   * backs up and comes forward again, gets the visit they already have rather than a
   * second one. Two visits for one person standing at one kiosk would produce two intakes
   * and, eventually, two tokens.
   */
  async open(input: OpenVisitInput): Promise<PreCheckinRow> {
    const session = await this.sessions.findById(input.sessionId);
    if (!session) {
      throw new DomainError('SESSION_EXPIRED', input.correlationId, 'unknown session');
    }

    // The patient comes from the SESSION, never from the request body. A client that
    // could name the patient could open a visit against anyone in the hospital.
    if (!session.patient_id) {
      throw new DomainError(
        'CONSENT_REQUIRED',
        input.correlationId,
        'no confirmed patient on this session',
      );
    }

    // Identity must already be confirmed. Opening a visit for someone the kiosk has not
    // finished identifying is how one patient's intake ends up on another's record.
    if (session.state !== 'IDENTITY_CONFIRMED' && session.state !== 'INTAKE_IN_PROGRESS') {
      throw new DomainError(
        'VALIDATION_FAILED',
        input.correlationId,
        `cannot open a visit from ${session.state}`,
      );
    }

    const consent = await this.consents.requireActiveConsent(
      session.patient_id,
      input.correlationId,
    );

    const existing = await this.db
      .selectFrom('pre_checkin')
      .selectAll()
      .where('patient_id', '=', session.patient_id)
      .where('kiosk_session_id', '=', input.sessionId)
      .executeTakeFirst();
    if (existing) return existing;

    const department = await this.db
      .selectFrom('department')
      .selectAll()
      .where('code', '=', input.departmentCode)
      .where('branch_id', '=', input.branchId)
      .where('enabled', '=', true)
      .executeTakeFirst();

    // Scoped to this kiosk's own branch, so a device cannot open a visit in a department
    // it does not stand outside of.
    if (!department) {
      throw new DomainError(
        'VALIDATION_FAILED',
        input.correlationId,
        `unknown department ${input.departmentCode}`,
      );
    }

    return withSerializableRetry(this.db, async (trx) => {
      const now = new Date();
      const row = await trx
        .insertInto('pre_checkin')
        .values({
          patient_id: session.patient_id as string,
          consent_id: consent.id,
          hospital_id: input.hospitalId,
          branch_id: input.branchId,
          department_id: department.id,
          kiosk_session_id: input.sessionId,
          visit_type: 'NEW_COMPLAINT',
          // The patient is standing here. The window opens now and closes at the end of
          // the working day rather than at a fixed offset: an intake interrupted by a long
          // queue must not expire while the patient is still in the building.
          visit_window_start: now,
          visit_window_end: endOfDay(now),
          state: 'DRAFT',
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.audit.append(
        {
          actorId: input.actorId,
          actorRole: 'kiosk',
          action: 'PRE_CHECKIN_CREATED',
          entityType: 'pre_checkin',
          entityId: row.id,
          correlationId: input.correlationId,
          detail: { origin: 'KIOSK_WALK_IN', departmentCode: input.departmentCode },
        },
        trx,
      );

      return row;
    });
  }

  /**
   * Confirms the arrival of a walk-in and mints the handle the token step uses.
   *
   * This is the second route into `ARRIVAL_CONFIRMED`, and the only thing standing
   * between it and a mobile pre-check-in reaching a token without ever being scanned is
   * the check below. A visit with no `kiosk_session_id` was not opened at a kiosk, so its
   * patient's presence has not been established by anything, and it is refused here
   * whatever state it is in.
   *
   * A scan proves presence for the mobile patient. For the walk-in, the proof is that the
   * entire intake was just conducted on this device — which is stronger, not weaker.
   */
  async confirmWalkInArrival(input: {
    preCheckinId: string;
    kioskDeviceId: string;
    correlationId: string;
    actorId: string;
    handleTtlSeconds: number;
  }): Promise<string> {
    return withSerializableRetry(this.db, async (trx) => {
      const row = await trx
        .selectFrom('pre_checkin')
        .selectAll()
        .where('id', '=', input.preCheckinId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      if (row.kiosk_session_id === null) {
        throw new DomainError(
          'VALIDATION_FAILED',
          input.correlationId,
          'not a walk-in visit; arrival must be confirmed by scanning',
        );
      }

      // Already confirmed — a retried submission gets the handle it has rather than a
      // second arrival. Re-minting is safe and deliberate: a handle rotates on every use.
      if (row.state === 'ARRIVAL_CONFIRMED' || row.state === 'TOKEN_REQUESTED') {
        return this.rotateHandle(trx, row.id, input.handleTtlSeconds);
      }

      if (row.state === 'DRAFT') {
        preCheckinMachine.assertTransition(row.state, 'SUBMITTED');
        await trx
          .updateTable('pre_checkin')
          .set({ state: 'SUBMITTED', submitted_at: new Date() })
          .where('id', '=', row.id)
          .execute();
      }

      preCheckinMachine.assertTransition('SUBMITTED', 'ARRIVAL_CONFIRMED');
      await trx
        .updateTable('pre_checkin')
        .set({
          state: 'ARRIVAL_CONFIRMED',
          arrival_confirmed_at: new Date(),
          arrival_kiosk_id: input.kioskDeviceId,
        })
        .where('id', '=', row.id)
        .execute();

      await this.audit.append(
        {
          actorId: input.actorId,
          actorRole: 'kiosk',
          action: 'ARRIVAL_CONFIRMED',
          entityType: 'pre_checkin',
          entityId: row.id,
          correlationId: input.correlationId,
          detail: { origin: 'KIOSK_WALK_IN' },
        },
        trx,
      );

      return this.rotateHandle(trx, row.id, input.handleTtlSeconds);
    });
  }

  /** A fresh, short-lived handle. The previous one stops working the moment this runs. */
  private async rotateHandle(
    trx: Parameters<Parameters<typeof withSerializableRetry>[1]>[0],
    preCheckinId: string,
    ttlSeconds: number,
  ): Promise<string> {
    const handle = randomUUID();
    await trx
      .updateTable('pre_checkin')
      .set({
        arrival_handle: handle,
        arrival_handle_expires_at: new Date(Date.now() + ttlSeconds * 1000),
      })
      .where('id', '=', preCheckinId)
      .execute();
    return handle;
  }

  /** Moves the session into the interview once its visit exists. */
  async beginIntake(sessionId: string): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (session?.state === 'IDENTITY_CONFIRMED') {
      await this.sessions.transition(sessionId, 'INTAKE_IN_PROGRESS');
    }
  }
}

function endOfDay(from: Date): Date {
  const end = new Date(from);
  end.setHours(23, 59, 59, 999);
  return end;
}
