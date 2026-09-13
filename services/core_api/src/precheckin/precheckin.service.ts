import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { CreatePreCheckinRequest } from '@medikiosk/api-contracts';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import type { PreCheckinRow } from '../db/database.types';
import { DomainError } from '../common/domain-error';
import { withSerializableRetry } from '../db/transaction';
import { preCheckinMachine } from '../state-machines';
import { AuditRepository } from '../audit/audit.repository';
import { ConsentService } from '../consent/consent.service';
import { QrNonceRepository } from '../arrival/qr-nonce.repository';
import { QrTokenService, type SignedQr } from './qr-token.service';

/** How long a QR stays valid. Long enough to walk to the kiosk, not to leave lying around. */
const QR_TTL_SECONDS = 300;

@Injectable()
export class PreCheckinService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly consents: ConsentService,
    private readonly nonces: QrNonceRepository,
    private readonly qr: QrTokenService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Creates a pre-check-in against an existing consent.
   *
   * The consent is checked here, not merely referenced. A pre-check-in is the container
   * for everything the patient is about to disclose, so it must not exist at all unless
   * there is a live legal basis for collecting it.
   */
  async create(
    request: CreatePreCheckinRequest,
    context: { readonly correlationId: string; readonly actorId: string },
  ): Promise<PreCheckinRow> {
    const consent = await this.db
      .selectFrom('consent')
      .selectAll()
      .where('id', '=', request.consentId)
      .executeTakeFirst();

    if (!consent) {
      throw new DomainError('CONSENT_REQUIRED', context.correlationId, 'unknown consent');
    }
    await this.consents.requireActiveConsent(consent.patient_id, context.correlationId);

    const location = await this.resolveLocation(request, context.correlationId);

    return withSerializableRetry(this.db, async (trx) => {
      // The demographics carried on the request promote the provisional patient the
      // consent created, rather than creating a second record the consent does not cover.
      await trx
        .updateTable('patient')
        .set({
          provisional: false,
          full_name: request.demographics.name,
          sex: request.demographics.sex,
          date_of_birth: request.demographics.dateOfBirth
            ? new Date(request.demographics.dateOfBirth)
            : null,
          age_years: request.demographics.ageYears ?? null,
          mobile: request.demographics.mobile,
          email: request.demographics.email ?? null,
          address: request.demographics.address ?? null,
        })
        .where('id', '=', consent.patient_id)
        .where('provisional', '=', true)
        .execute();

      const row = await trx
        .insertInto('pre_checkin')
        .values({
          patient_id: consent.patient_id,
          consent_id: consent.id,
          hospital_id: location.hospitalId,
          branch_id: location.branchId,
          department_id: location.departmentId,
          visit_type: request.visit.visitType,
          appointment_ref: request.visit.appointmentRef ?? null,
          visit_window_start: new Date(request.visit.visitWindowStart),
          visit_window_end: new Date(request.visit.visitWindowEnd),
          state: 'DRAFT',
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.audit.append(
        {
          actorId: context.actorId,
          actorRole: 'PATIENT',
          action: 'PRE_CHECKIN_CREATED',
          entityType: 'pre_checkin',
          entityId: row.id,
          correlationId: context.correlationId,
          detail: { visitType: request.visit.visitType },
        },
        trx,
      );

      return row;
    });
  }

  /** Marks a draft as submitted. Only a submitted intake may be given a QR. */
  async submit(
    preCheckinId: string,
    context: { correlationId: string; actorId: string },
  ): Promise<PreCheckinRow> {
    return withSerializableRetry(this.db, async (trx) => {
      const current = await this.lock(trx, preCheckinId, context.correlationId);
      preCheckinMachine.assertTransition(current.state, 'SUBMITTED');

      const row = await trx
        .updateTable('pre_checkin')
        .set({ state: 'SUBMITTED', submitted_at: new Date() })
        .where('id', '=', preCheckinId)
        .where('version', '=', current.version)
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.audit.append(
        {
          actorId: context.actorId,
          actorRole: 'PATIENT',
          action: 'PRE_CHECKIN_SUBMITTED',
          entityType: 'pre_checkin',
          entityId: preCheckinId,
          correlationId: context.correlationId,
        },
        trx,
      );

      return row;
    });
  }

  /**
   * Issues a signed, single-use QR.
   *
   * Re-issuing is allowed and retires the previous nonce, so a patient who closed the app
   * is not stranded — but two codes for one visit never circulate at once.
   */
  async issueQr(
    preCheckinId: string,
    context: { correlationId: string; actorId: string },
  ): Promise<SignedQr> {
    const current = await this.db
      .selectFrom('pre_checkin')
      .innerJoin('hospital', 'hospital.id', 'pre_checkin.hospital_id')
      .innerJoin('branch', 'branch.id', 'pre_checkin.branch_id')
      .innerJoin('department', 'department.id', 'pre_checkin.department_id')
      .select([
        'pre_checkin.id as id',
        'pre_checkin.state as state',
        'pre_checkin.visit_window_start as windowStart',
        'pre_checkin.visit_window_end as windowEnd',
        'hospital.code as hospitalCode',
        'branch.code as branchCode',
        'department.code as departmentCode',
      ])
      .where('pre_checkin.id', '=', preCheckinId)
      .executeTakeFirst();

    if (!current) {
      throw new DomainError('VALIDATION_FAILED', context.correlationId, 'unknown pre-check-in');
    }
    preCheckinMachine.assertTransition(current.state, 'QR_ISSUED');

    const expiresAt = new Date(Date.now() + QR_TTL_SECONDS * 1000);
    const nonce = await this.nonces.issue({
      preCheckinId,
      signingKeyId: 'pending',
      expiresAt,
    });

    const signed = this.qr.sign(
      {
        preCheckinId,
        hospitalId: current.hospitalCode,
        branchId: current.branchCode,
        departmentId: current.departmentCode,
        visitWindowStart: new Date(current.windowStart).toISOString(),
        visitWindowEnd: new Date(current.windowEnd).toISOString(),
        nonce: nonce.nonce,
      },
      QR_TTL_SECONDS,
    );

    await this.db
      .updateTable('qr_nonce')
      .set({ signing_key_id: signed.keyId })
      .where('id', '=', nonce.id)
      .execute();

    await this.db
      .updateTable('pre_checkin')
      .set({ state: 'QR_ISSUED' })
      .where('id', '=', preCheckinId)
      .execute();

    await this.audit.append({
      actorId: context.actorId,
      actorRole: 'PATIENT',
      action: 'QR_ISSUED',
      entityType: 'pre_checkin',
      entityId: preCheckinId,
      correlationId: context.correlationId,
      detail: { keyId: signed.keyId, expiresAt: signed.expiresAt.toISOString() },
    });

    return signed;
  }

  async findById(id: string): Promise<PreCheckinRow | undefined> {
    return this.db.selectFrom('pre_checkin').selectAll().where('id', '=', id).executeTakeFirst();
  }

  /** Resolves hospital/branch/department codes to ids, refusing an inconsistent triple. */
  private async resolveLocation(
    request: CreatePreCheckinRequest,
    correlationId: string,
  ): Promise<{ hospitalId: string; branchId: string; departmentId: string }> {
    const row = await this.db
      .selectFrom('department')
      .innerJoin('branch', 'branch.id', 'department.branch_id')
      .innerJoin('hospital', 'hospital.id', 'branch.hospital_id')
      .select([
        'hospital.id as hospitalId',
        'branch.id as branchId',
        'department.id as departmentId',
      ])
      .where('hospital.code', '=', request.visit.hospitalId)
      .where('branch.code', '=', request.visit.branchId)
      .where('department.code', '=', request.visit.departmentId)
      .where('department.enabled', '=', true)
      .executeTakeFirst();

    if (!row) {
      // A department that is not under the named branch of the named hospital is not a
      // typo to be corrected — it is a visit that does not exist.
      throw new DomainError(
        'VALIDATION_FAILED',
        correlationId,
        'no enabled department matches that hospital, branch and department',
      );
    }
    return row;
  }

  private async lock(
    trx: Parameters<Parameters<typeof withSerializableRetry>[1]>[0],
    id: string,
    correlationId: string,
  ): Promise<PreCheckinRow> {
    const row = await trx
      .selectFrom('pre_checkin')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) {
      throw new DomainError('VALIDATION_FAILED', correlationId, 'unknown pre-check-in');
    }
    return row;
  }

  /** Housekeeping: mark pre-check-ins whose QR has lapsed. */
  async expireLapsedQrs(): Promise<number> {
    const result = await this.db
      .updateTable('pre_checkin')
      .set({ state: 'QR_EXPIRED' })
      .where('state', '=', 'QR_ISSUED')
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('qr_nonce')
              .select('qr_nonce.id')
              .whereRef('qr_nonce.pre_checkin_id', '=', 'pre_checkin.id')
              .where('qr_nonce.state', '=', 'ISSUED')
              .where('qr_nonce.expires_at', '>', sql<Date>`now()`),
          ),
        ),
      )
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }
}
