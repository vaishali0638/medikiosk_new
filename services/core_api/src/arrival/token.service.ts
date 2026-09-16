import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { HisAdapter } from '@medikiosk/his-adapter';
import type { TokenResponse, VisitType } from '@medikiosk/api-contracts';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import type { TokenRequestRow } from '../db/database.types';
import { DomainError } from '../common/domain-error';
import { AuditRepository } from '../audit/audit.repository';
import { TokenRequestRepository, tokenIdempotencyKey } from './token-request.repository';
import type { KioskContext } from '../kiosk/kiosk-device.guard';

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly his: HisAdapter,
    private readonly requests: TokenRequestRepository,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Requests the hospital token for a confirmed arrival.
   *
   * The whole method is arranged around one rule: a patient gets at most one token for a
   * visit, ever. Four things enforce it, at four different layers, because any single one
   * of them can be defeated by a bug:
   *
   *   1. The idempotency key is DERIVED (`<kioskCode>-<preCheckinId>`), never supplied by
   *      the client, so every retry path converges on the same row.
   *   2. That column is UNIQUE, so concurrent requests collapse instead of racing.
   *   3. An already-ISSUED request short-circuits before the HIS is contacted at all.
   *   4. A partial unique index refuses a second ISSUED row for the visit even if
   *      something bypassed all of the above.
   */
  async requestToken(
    preCheckinId: string,
    kiosk: KioskContext,
    correlationId: string,
  ): Promise<TokenResponse> {
    const visit = await this.loadVisit(preCheckinId, correlationId);

    const { row } = await this.requests.open({
      preCheckinId,
      kioskDeviceCode: kiosk.deviceCode,
      kioskDeviceId: kiosk.deviceId,
    });

    // Already done. Return what the hospital gave us rather than asking again — asking
    // again is how a second token gets created.
    if (row.state === 'ISSUED') return this.toResponse(row, visit.departmentName);

    // A previous attempt left this unresolved. Only a human may move it, so the kiosk is
    // told to send the patient to the counter rather than quietly retrying.
    if (row.state === 'UNKNOWN_RECONCILIATION_REQUIRED') {
      throw new DomainError(
        'TOKEN_RECONCILIATION_REQUIRED',
        correlationId,
        `token request ${row.idempotency_key} awaits reconciliation`,
      );
    }

    // A request that was sent but never resolved: ask the HIS what it already did before
    // sending anything new.
    if (row.state === 'REQUESTED' || row.state === 'ACKNOWLEDGED') {
      return this.reconcileInFlight(row, visit, correlationId);
    }

    return this.send(row, visit, kiosk, correlationId);
  }

  /**
   * Reads the recorded outcome. Deliberately does NOT contact the HIS: a kiosk polling
   * while it waits must not be able to generate hospital traffic, and must not be a path
   * by which a second request could be sent.
   */
  async getStatus(
    preCheckinId: string,
    kiosk: KioskContext,
  ): Promise<{ tokenState: string; token?: string; reconciliationRequired: boolean }> {
    const key = tokenIdempotencyKey(kiosk.deviceCode, preCheckinId);
    const row = await this.requests.findByKey(key);
    if (!row) {
      return { tokenState: 'NOT_STARTED' as const, reconciliationRequired: false };
    }
    return {
      tokenState: row.state,
      ...(row.his_token ? { token: row.his_token } : {}),
      reconciliationRequired: row.state === 'UNKNOWN_RECONCILIATION_REQUIRED',
    };
  }

  private async send(
    row: TokenRequestRow,
    visit: VisitContext,
    kiosk: KioskContext,
    correlationId: string,
  ): Promise<TokenResponse> {
    const key = row.idempotency_key;
    await this.requests.markRequested(key);

    const startedAt = Date.now();
    let result: Awaited<ReturnType<HisAdapter['requestToken']>>;

    try {
      result = await this.his.requestToken({
        idempotencyKey: key,
        hospitalCode: visit.hospitalCode,
        branchCode: visit.branchCode,
        departmentCode: visit.departmentCode,
        uhid: visit.uhid,
        visitType: visit.visitType,
        appointmentRef: visit.appointmentRef,
        correlationId,
      });
    } catch (error) {
      // A thrown adapter is an unknown outcome, not a failure: the request may well have
      // reached the hospital before the connection died.
      result = {
        outcome: 'UNCERTAIN',
        detail: error instanceof Error ? error.message : 'adapter threw',
      };
    }

    const latencyMs = Date.now() - startedAt;

    switch (result.outcome) {
      case 'ISSUED': {
        const issued = await this.requests.recordIssued({
          idempotencyKey: key,
          hisToken: result.token,
          hisResponseRef: result.hisEncounterRef,
        });
        await this.db
          .updateTable('token_request')
          .set({
            room: result.room ?? null,
            queue_status: result.queueStatus ?? null,
            last_latency_ms: latencyMs,
          })
          .where('id', '=', issued.id)
          .execute();

        await this.audit.append({
          actorId: `kiosk:${kiosk.deviceCode}`,
          actorRole: 'KIOSK',
          action: 'TOKEN_ISSUED',
          entityType: 'token_request',
          entityId: issued.id,
          correlationId,
          detail: { adapter: this.his.kind, latencyMs },
        });

        // The visit is now real: the hospital has queued this patient. That is the point
        // at which an `encounter` exists to be verified later and, eventually, to be the
        // baseline a follow-up is measured against. Before this, there was only an
        // intention to be seen.
        await this.recordEncounter(row.pre_checkin_id, result.hisEncounterRef, result.token);

        // recordIssued returns the row as it was BEFORE room and queue status were
        // written, so they are carried over explicitly rather than read back.
        return this.toResponse(
          { ...issued, room: result.room ?? null, queue_status: result.queueStatus ?? null },
          visit.departmentName,
        );
      }

      case 'REJECTED': {
        await this.requests.markFailed(key, result.errorCode);
        await this.audit.append({
          actorId: `kiosk:${kiosk.deviceCode}`,
          actorRole: 'KIOSK',
          action: 'TOKEN_REJECTED',
          entityType: 'token_request',
          entityId: row.id,
          correlationId,
          detail: { errorCode: result.errorCode, latencyMs },
        });
        throw new DomainError('TOKEN_REQUEST_FAILED', correlationId, result.errorCode);
      }

      case 'UNCERTAIN':
        // One immediate poll, but only to RECOVER a token — never to conclude there
        // isn't one. See reconcileInFlight.
        return this.reconcileInFlight(row, visit, correlationId, result.detail, 'immediate');
    }
  }

  /**
   * Resolves a request whose outcome is unknown by asking the HIS what it already did.
   *
   * The heart of the no-duplicate guarantee: the system never decides between "retry" and
   * "give up" on its own evidence — it asks the only authority that knows.
   *
   * `timing` matters more than it looks. A poll issued MILLISECONDS after a timeout is
   * racing the hospital's own commit, so a NOT_FOUND then means "not yet", not "never" —
   * acting on it would let a retry overtake a request that is about to succeed. A poll on
   * a LATER attempt, after the first request has definitively ended, can be believed.
   *
   * So an immediate poll may only ever recover a token; it may never conclude there is
   * none. That costs a patient a trip to the counter in the rare uncertain case, which is
   * the right trade against handing someone a second hospital token.
   */
  private async reconcileInFlight(
    row: TokenRequestRow,
    visit: VisitContext,
    correlationId: string,
    detail = 'in-flight request found on a later attempt',
    timing: 'immediate' | 'later' = 'later',
  ): Promise<TokenResponse> {
    const key = row.idempotency_key;

    let status: Awaited<ReturnType<HisAdapter['getTokenStatus']>>;
    try {
      status = await this.his.getTokenStatus(key, correlationId);
    } catch (error) {
      status = {
        outcome: 'UNCERTAIN',
        detail: error instanceof Error ? error.message : 'status poll threw',
      };
    }

    if (status.outcome === 'ISSUED') {
      // The hospital had already issued one. Record it; do not request another.
      const issued = await this.requests.recordIssued({
        idempotencyKey: key,
        hisToken: status.token,
      });
      await this.db
        .updateTable('token_request')
        .set({ room: status.room ?? null, queue_status: status.queueStatus ?? null })
        .where('id', '=', issued.id)
        .execute();

      return this.toResponse(
        { ...issued, room: status.room ?? null, queue_status: status.queueStatus ?? null },
        visit.departmentName,
      );
    }

    if (status.outcome === 'NOT_FOUND' && timing === 'later') {
      // The earlier request has definitively ended and the hospital is certain it holds
      // no token for this key, so a fresh attempt cannot duplicate anything. Recorded as
      // FAILED first, which is the only state a retry is permitted from.
      await this.requests.markFailed(key, 'HIS_NO_RECORD');
      throw new DomainError(
        'TOKEN_REQUEST_FAILED',
        correlationId,
        'HIS has no record of this request; safe to retry',
      );
    }

    await this.requests.markReconciliationRequired(key, detail);
    this.logger.warn(`Token request ${key} needs reconciliation: ${detail}`);

    await this.audit.append({
      actorId: 'SYSTEM',
      actorRole: 'SYSTEM',
      action: 'TOKEN_RECONCILIATION_REQUIRED',
      entityType: 'token_request',
      entityId: row.id,
      correlationId,
      detail: { reason: detail, adapter: this.his.kind },
    });

    throw new DomainError('TOKEN_RECONCILIATION_REQUIRED', correlationId, detail);
  }

  /**
   * Creates the encounter for a realised visit, once.
   *
   * Idempotent by a partial unique index on `pre_checkin_id`: a reconciliation sweep that
   * discovers a token was issued after all must not produce a second encounter, or the
   * patient acquires two clinical visits for one attendance.
   *
   * It is deliberately NOT verified here. Nothing a kiosk does verifies a record — that
   * is a clinician's act, and the columns for it stay null until Phase 13.
   */
  private async recordEncounter(
    preCheckinId: string,
    hisEncounterRef: string | undefined,
    hisToken: string,
  ): Promise<void> {
    const visit = await this.db
      .selectFrom('pre_checkin')
      .innerJoin('department', 'department.id', 'pre_checkin.department_id')
      .select([
        'pre_checkin.patient_id as patientId',
        'pre_checkin.department_id as departmentId',
        'pre_checkin.visit_type as visitType',
        'department.ayush_system as ayushSystem',
      ])
      .where('pre_checkin.id', '=', preCheckinId)
      .executeTakeFirst();
    if (!visit) return;

    const encounter = await this.db
      .insertInto('encounter')
      .values({
        patient_id: visit.patientId,
        department_id: visit.departmentId,
        pre_checkin_id: preCheckinId,
        visit_type: visit.visitType,
        ayush_system: visit.ayushSystem,
        his_encounter_ref: hisEncounterRef ?? null,
        his_token: hisToken,
        token_issued_at: new Date(),
      })
      .onConflict((oc) => oc.column('pre_checkin_id').doNothing())
      .returning('id')
      .executeTakeFirst();

    if (encounter) {
      await this.db
        .updateTable('pre_checkin')
        .set({ encounter_id: encounter.id })
        .where('id', '=', preCheckinId)
        .execute();
    }
  }

  private async loadVisit(preCheckinId: string, correlationId: string): Promise<VisitContext> {
    const row = await this.db
      .selectFrom('pre_checkin')
      .innerJoin('hospital', 'hospital.id', 'pre_checkin.hospital_id')
      .innerJoin('branch', 'branch.id', 'pre_checkin.branch_id')
      .innerJoin('department', 'department.id', 'pre_checkin.department_id')
      .leftJoin('patient_identifier', (join) =>
        join
          .onRef('patient_identifier.patient_id', '=', 'pre_checkin.patient_id')
          .on('patient_identifier.type', '=', 'UHID'),
      )
      .select([
        'pre_checkin.state as state',
        'pre_checkin.visit_type as visitType',
        'pre_checkin.appointment_ref as appointmentRef',
        'hospital.code as hospitalCode',
        'branch.code as branchCode',
        'department.code as departmentCode',
        'department.name as departmentName',
        'patient_identifier.value as uhid',
      ])
      .where('pre_checkin.id', '=', preCheckinId)
      .executeTakeFirst();

    if (!row) {
      throw new DomainError('VALIDATION_FAILED', correlationId, 'unknown pre-check-in');
    }

    // A token is the end of arrival, not a substitute for it. Without a confirmed arrival
    // the hospital would be queuing someone who is not standing in the building.
    if (
      row.state !== 'ARRIVAL_CONFIRMED' &&
      row.state !== 'TOKEN_REQUESTED' &&
      row.state !== 'TOKEN_ISSUED' &&
      row.state !== 'RECONCILIATION_REQUIRED'
    ) {
      throw new DomainError(
        'IDENTITY_NOT_CONFIRMED',
        correlationId,
        `pre-check-in is ${row.state}, not a confirmed arrival`,
      );
    }

    return {
      hospitalCode: row.hospitalCode,
      branchCode: row.branchCode,
      departmentCode: row.departmentCode,
      departmentName: row.departmentName,
      visitType: row.visitType,
      appointmentRef: row.appointmentRef ?? undefined,
      uhid: row.uhid ?? undefined,
    };
  }

  private toResponse(
    row: Pick<TokenRequestRow, 'state' | 'his_token' | 'issued_at' | 'queue_status'> & {
      room?: string | null;
    },
    departmentName: string,
  ): TokenResponse {
    return {
      state: row.state,
      ...(row.his_token ? { token: row.his_token } : {}),
      departmentName,
      ...(row.room ? { room: row.room } : {}),
      ...(row.queue_status ? { queueStatus: row.queue_status } : {}),
      ...(row.issued_at ? { issuedAt: row.issued_at.toISOString() } : {}),
    };
  }

  /** Everything a human must resolve, oldest first. */
  async listReconciliation(): Promise<
    Array<{
      idempotencyKey: string;
      preCheckinId: string;
      note: string | null;
      attempts: number;
      createdAt: string;
    }>
  > {
    const rows = await this.requests.listAwaitingReconciliation();
    return rows.map((row) => ({
      idempotencyKey: row.idempotency_key,
      preCheckinId: row.pre_checkin_id,
      note: row.reconciliation_note,
      attempts: row.attempt_count,
      createdAt: row.created_at.toISOString(),
    }));
  }

  /**
   * Re-polls the HIS for every unresolved request.
   *
   * Run on a schedule and from the ops dashboard. Safe by construction: it only ever
   * polls status, never requests a token, so it can be run as often as needed.
   */
  async sweepReconciliation(correlationId: string): Promise<{ resolved: number; pending: number }> {
    const pending = await this.requests.listAwaitingReconciliation();
    let resolved = 0;

    for (const row of pending) {
      try {
        const status = await this.his.getTokenStatus(row.idempotency_key, correlationId);
        if (status.outcome !== 'ISSUED') continue;

        // The row is terminal for the automated path, so it is moved deliberately here
        // rather than through the normal transition, and audited as an operator action.
        await this.db
          .updateTable('token_request')
          .set({
            state: 'ISSUED',
            his_token: status.token,
            issued_at: sql<Date>`now()`,
            room: status.room ?? null,
            queue_status: status.queueStatus ?? null,
            reconciliation_note: 'resolved by status poll: HIS had issued a token',
          })
          .where('id', '=', row.id)
          .execute();

        await this.audit.append({
          actorId: 'SYSTEM',
          actorRole: 'SYSTEM',
          action: 'TOKEN_RECONCILED',
          entityType: 'token_request',
          entityId: row.id,
          correlationId,
          detail: { idempotencyKey: row.idempotency_key },
        });
        resolved += 1;
      } catch {
        // Still unreachable. Leave it pending; a human can act on it in the dashboard.
      }
    }

    return { resolved, pending: pending.length - resolved };
  }
}

interface VisitContext {
  readonly hospitalCode: string;
  readonly branchCode: string;
  readonly departmentCode: string;
  readonly departmentName: string;
  readonly visitType: VisitType;
  readonly appointmentRef?: string | undefined;
  readonly uhid?: string | undefined;
}
