import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { ArrivalConfirmRequest } from '@medikiosk/api-contracts';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import { DomainError } from '../common/domain-error';
import { maskName, maskTail } from '../common/redact';
import { withSerializableRetry } from '../db/transaction';
import { preCheckinMachine } from '../state-machines';
import { AuditRepository } from '../audit/audit.repository';
import { QrTokenService } from '../precheckin/qr-token.service';
import { QrNonceRepository } from './qr-nonce.repository';
import type { KioskContext } from '../kiosk/kiosk-device.guard';

/** The handle lives only for the few minutes a patient spends at the kiosk. */
/** How long a rotated arrival or token handle stays usable. Shared with the walk-in
 *  path so the two ways of arriving expire on the same clock. */
export const ARRIVAL_HANDLE_TTL_SECONDS = 300;

/**
 * Why an arrival was refused. Internal only — every one of these produces the same
 * screen and the same message, because distinguishing them would let a holder of a
 * stolen code work out what to change.
 */
export type ArrivalRefusal =
  | 'QR_MALFORMED'
  | 'QR_BAD_SIGNATURE'
  | 'QR_EXPIRED'
  | 'QR_UNKNOWN_KEY'
  | 'NONCE_NOT_FOUND'
  | 'NONCE_ALREADY_USED'
  | 'NONCE_EXPIRED'
  | 'NONCE_REVOKED'
  | 'WRONG_HOSPITAL'
  | 'WRONG_BRANCH'
  | 'WRONG_DEPARTMENT'
  | 'OUTSIDE_VISIT_WINDOW'
  | 'PRE_CHECKIN_NOT_SUBMITTED'
  | 'PRE_CHECKIN_CANCELLED'
  | 'CONSENT_NOT_ACTIVE'
  | 'TOKEN_ALREADY_ISSUED'
  | 'PATIENT_MISSING';

export interface ArrivalCandidate {
  readonly arrivalHandle: string;
  readonly maskedName: string;
  readonly maskedMobile: string;
  readonly hospitalName: string;
  readonly departmentName: string;
  readonly visitType: string;
}

@Injectable()
export class ArrivalService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly qr: QrTokenService,
    private readonly nonces: QrNonceRepository,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Validates a scanned QR and opens an arrival.
   *
   * Every check is performed, in this order, and any failure produces the same neutral
   * outcome. The order is chosen so that nothing from the payload is trusted before the
   * signature has been checked, and so the one-time nonce is spent as early as possible —
   * a replayed code must fail even if the rest of the visit is perfectly valid.
   *
   * The nonce is consumed on a successful scan rather than on confirmation. A patient who
   * scans and walks away can reissue from their phone; a code that stayed live after
   * being scanned would be replayable by anyone who photographed the screen.
   */
  async checkIn(
    qrPayload: string,
    kiosk: KioskContext,
    correlationId: string,
  ): Promise<ArrivalCandidate> {
    const verified = this.qr.verify(qrPayload);
    if (!verified.ok) {
      const reason: ArrivalRefusal =
        verified.reason === 'BAD_SIGNATURE'
          ? 'QR_BAD_SIGNATURE'
          : verified.reason === 'EXPIRED'
            ? 'QR_EXPIRED'
            : verified.reason === 'UNKNOWN_KEY'
              ? 'QR_UNKNOWN_KEY'
              : 'QR_MALFORMED';
      return this.refuse(reason, kiosk, correlationId, null);
    }

    const claims = verified.claims;

    // Facility binding is checked before the nonce is spent, so a code presented at the
    // wrong hospital is not also burned for the right one.
    const facility = await this.db
      .selectFrom('pre_checkin')
      .innerJoin('hospital', 'hospital.id', 'pre_checkin.hospital_id')
      .innerJoin('branch', 'branch.id', 'pre_checkin.branch_id')
      .innerJoin('department', 'department.id', 'pre_checkin.department_id')
      .innerJoin('patient', 'patient.id', 'pre_checkin.patient_id')
      .select([
        'pre_checkin.id as preCheckinId',
        'pre_checkin.state as state',
        'pre_checkin.visit_type as visitType',
        'pre_checkin.visit_window_start as windowStart',
        'pre_checkin.visit_window_end as windowEnd',
        'pre_checkin.consent_id as consentId',
        'hospital.id as hospitalId',
        'hospital.code as hospitalCode',
        'hospital.name as hospitalName',
        'branch.id as branchId',
        'branch.code as branchCode',
        'department.code as departmentCode',
        'department.name as departmentName',
        'patient.id as patientId',
        'patient.full_name as fullName',
        'patient.mobile as mobile',
      ])
      .where('pre_checkin.id', '=', claims.preCheckinId)
      .executeTakeFirst();

    if (!facility) return this.refuse('NONCE_NOT_FOUND', kiosk, correlationId, null);

    const preCheckinId = facility.preCheckinId;

    if (facility.hospitalCode !== claims.hospitalId || facility.hospitalId !== kiosk.hospitalId) {
      return this.refuse('WRONG_HOSPITAL', kiosk, correlationId, preCheckinId);
    }
    if (facility.branchCode !== claims.branchId || facility.branchId !== kiosk.branchId) {
      return this.refuse('WRONG_BRANCH', kiosk, correlationId, preCheckinId);
    }
    if (facility.departmentCode !== claims.departmentId) {
      return this.refuse('WRONG_DEPARTMENT', kiosk, correlationId, preCheckinId);
    }

    const now = Date.now();
    if (
      now < new Date(facility.windowStart).getTime() ||
      now > new Date(facility.windowEnd).getTime()
    ) {
      return this.refuse('OUTSIDE_VISIT_WINDOW', kiosk, correlationId, preCheckinId);
    }

    if (facility.state === 'CANCELLED') {
      return this.refuse('PRE_CHECKIN_CANCELLED', kiosk, correlationId, preCheckinId);
    }
    if (facility.state !== 'QR_ISSUED') {
      return this.refuse('PRE_CHECKIN_NOT_SUBMITTED', kiosk, correlationId, preCheckinId);
    }

    const consent = await this.db
      .selectFrom('consent')
      .selectAll()
      .where('id', '=', facility.consentId)
      .where('state', '=', 'GRANTED')
      .where('valid_until', '>', sql<Date>`now()`)
      .executeTakeFirst();
    if (!consent) return this.refuse('CONSENT_NOT_ACTIVE', kiosk, correlationId, preCheckinId);

    const issued = await this.db
      .selectFrom('token_request')
      .select('id')
      .where('pre_checkin_id', '=', preCheckinId)
      .where('state', '=', 'ISSUED')
      .executeTakeFirst();
    if (issued) return this.refuse('TOKEN_ALREADY_ISSUED', kiosk, correlationId, preCheckinId);

    // Spend the code. Atomic, and the last check — everything above could be retried by
    // the same patient without penalty, but a scan that gets this far is the arrival.
    const consumed = await this.nonces.consume(claims.nonce, kiosk.deviceId);
    if (!consumed.ok) {
      const reason: ArrivalRefusal =
        consumed.reason === 'ALREADY_CONSUMED'
          ? 'NONCE_ALREADY_USED'
          : consumed.reason === 'EXPIRED'
            ? 'NONCE_EXPIRED'
            : consumed.reason === 'REVOKED'
              ? 'NONCE_REVOKED'
              : 'NONCE_NOT_FOUND';
      return this.refuse(reason, kiosk, correlationId, preCheckinId);
    }

    if (!QrTokenService.nonceMatches(consumed.nonce.pre_checkin_id, preCheckinId)) {
      // The nonce verified but belongs to a different visit — a spliced token.
      return this.refuse('NONCE_NOT_FOUND', kiosk, correlationId, preCheckinId);
    }

    const arrivalHandle = randomUUID();
    await this.db
      .updateTable('pre_checkin')
      .set({
        arrival_handle: arrivalHandle,
        arrival_handle_expires_at: new Date(now + ARRIVAL_HANDLE_TTL_SECONDS * 1000),
        arrival_kiosk_id: kiosk.deviceId,
      })
      .where('id', '=', preCheckinId)
      .execute();

    await this.audit.append({
      actorId: `kiosk:${kiosk.deviceCode}`,
      actorRole: 'KIOSK',
      action: 'ARRIVAL_QR_ACCEPTED',
      entityType: 'pre_checkin',
      entityId: preCheckinId,
      correlationId,
      detail: { keyId: verified.keyId },
    });

    return {
      arrivalHandle,
      maskedName: facility.fullName ? maskName(facility.fullName) : '',
      maskedMobile: facility.mobile ? maskTail(facility.mobile) : '',
      hospitalName: facility.hospitalName,
      departmentName: facility.departmentName,
      visitType: facility.visitType,
    };
  }

  /**
   * The patient confirms the masked visit is theirs, and declares what has changed.
   *
   * Only this step sets ARRIVAL_CONFIRMED, which is the precondition for a token request.
   * Scanning alone is not arrival: the person holding the phone still has to say the
   * visit on screen is the one they are here for.
   */
  async confirm(
    arrivalHandle: string,
    request: ArrivalConfirmRequest,
    kiosk: KioskContext,
    correlationId: string,
  ): Promise<{
    preCheckinId: string;
    tokenHandle: string;
    changedSections: readonly string[];
  }> {
    return withSerializableRetry(this.db, async (trx) => {
      const row = await trx
        .selectFrom('pre_checkin')
        .selectAll()
        .where('arrival_handle', '=', arrivalHandle)
        .forUpdate()
        .executeTakeFirst();

      if (
        !row ||
        !row.arrival_handle_expires_at ||
        new Date(row.arrival_handle_expires_at).getTime() <= Date.now()
      ) {
        throw new DomainError('QR_INVALID', correlationId, 'arrival handle unknown or expired');
      }

      preCheckinMachine.assertTransition(row.state, 'ARRIVAL_CONFIRMED');

      // The handle is ROTATED, not cleared. Requesting a token is a third step, and the
      // alternative — addressing the visit by its pre-check-in id — would hand that step
      // to anyone who photographed the QR, since the payload is signed but not encrypted.
      // A fresh value means the handle used to confirm cannot also fetch a token.
      const tokenHandle = randomUUID();

      await trx
        .updateTable('pre_checkin')
        .set({
          state: 'ARRIVAL_CONFIRMED',
          arrival_confirmed_at: new Date(),
          arrival_handle: tokenHandle,
          arrival_handle_expires_at: new Date(Date.now() + ARRIVAL_HANDLE_TTL_SECONDS * 1000),
        })
        .where('id', '=', row.id)
        .where('version', '=', row.version)
        .execute();

      await this.audit.append(
        {
          actorId: `kiosk:${kiosk.deviceCode}`,
          actorRole: 'KIOSK',
          action: 'ARRIVAL_CONFIRMED',
          entityType: 'pre_checkin',
          entityId: row.id,
          correlationId,
          detail: { changedSections: request.changedSections },
        },
        trx,
      );

      return { preCheckinId: row.id, tokenHandle, changedSections: request.changedSections };
    });
  }

  /**
   * Resolves a token handle to its visit, refusing an unknown or lapsed one.
   *
   * Every step after the scan addresses the visit through a handle rather than its
   * pre-check-in id, and each step rotates it, so a value observed at one step cannot be
   * replayed at the next.
   */
  async resolveTokenHandle(handle: string, correlationId: string): Promise<string> {
    const row = await this.db
      .selectFrom('pre_checkin')
      .select(['id', 'arrival_handle_expires_at'])
      .where('arrival_handle', '=', handle)
      .executeTakeFirst();

    if (
      !row ||
      !row.arrival_handle_expires_at ||
      new Date(row.arrival_handle_expires_at).getTime() <= Date.now()
    ) {
      throw new DomainError('QR_INVALID', correlationId, 'token handle unknown or expired');
    }
    return row.id;
  }

  /**
   * Records a refusal and throws the one neutral error.
   *
   * The specific reason reaches the audit log and nothing else. A patient sees the same
   * screen whether their code expired, was already used, or was issued for another
   * hospital — otherwise the kiosk becomes an oracle for probing stolen codes.
   */
  private async refuse(
    reason: ArrivalRefusal,
    kiosk: KioskContext,
    correlationId: string,
    preCheckinId: string | null,
  ): Promise<never> {
    await this.audit.append({
      actorId: `kiosk:${kiosk.deviceCode}`,
      actorRole: 'KIOSK',
      action: 'ARRIVAL_QR_REFUSED',
      entityType: 'pre_checkin',
      entityId: preCheckinId ?? undefined,
      correlationId,
      detail: { reason },
    });

    throw new DomainError('QR_INVALID', correlationId, reason);
  }
}
