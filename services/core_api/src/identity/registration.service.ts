import { Inject, Injectable } from '@nestjs/common';
import type { RegisterPatientRequest } from '@medikiosk/api-contracts';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import type { PatientRow } from '../db/database.types';
import { DomainError } from '../common/domain-error';
import { withSerializableRetry } from '../db/transaction';
import { AuditRepository } from '../audit/audit.repository';
import { OtpService } from './otp.service';

@Injectable()
export class RegistrationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly otp: OtpService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Registers a new patient by promoting the provisional row the consent artefact created.
   *
   * Promotion rather than insertion matters: the consent is already bound to the
   * provisional patient id, so creating a second row here would leave the real patient
   * with no consent and the consent pointing at an empty record.
   *
   * A possible duplicate does not block registration and does not merge anything. It is
   * flagged for staff, because refusing to register someone whose relative shares their
   * phone would deny care, and merging on a guess is exactly the wrong-patient failure.
   */
  async register(
    request: RegisterPatientRequest,
    context: {
      readonly hospitalId: string;
      readonly provisionalPatientId: string;
      readonly correlationId: string;
      readonly actorId: string;
    },
  ): Promise<{ patient: PatientRow; possibleDuplicates: number }> {
    const verification = await this.otp.consume(request.verificationId, context.correlationId);

    if (verification.purpose !== 'NEW_REGISTRATION') {
      throw new DomainError(
        'VALIDATION_FAILED',
        context.correlationId,
        `verification purpose is ${verification.purpose}`,
      );
    }

    return withSerializableRetry(this.db, async (trx) => {
      const provisional = await trx
        .selectFrom('patient')
        .selectAll()
        .where('id', '=', context.provisionalPatientId)
        .forUpdate()
        .executeTakeFirst();

      if (!provisional) {
        throw new DomainError('VALIDATION_FAILED', context.correlationId, 'unknown patient');
      }
      if (!provisional.provisional) {
        // Already registered. Re-running would overwrite a confirmed record's demographics
        // from a fresh registration form, which is a quiet way to corrupt the wrong patient.
        throw new DomainError(
          'VALIDATION_FAILED',
          context.correlationId,
          'patient is already registered',
        );
      }

      const patient = await trx
        .updateTable('patient')
        .set({
          provisional: false,
          full_name: request.name,
          sex: request.sex,
          date_of_birth: request.dateOfBirth ? new Date(request.dateOfBirth) : null,
          age_years: request.ageYears ?? null,
          mobile: verification.mobile,
          email: request.email ?? null,
          address: request.address ?? null,
        })
        .where('id', '=', provisional.id)
        .where('version', '=', provisional.version)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Surface possible duplicates rather than acting on them. Name similarity alone is
      // never grounds to merge; a hospital record officer decides.
      const duplicates = await trx
        .selectFrom('patient')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('hospital_id', '=', context.hospitalId)
        .where('provisional', '=', false)
        .where('id', '!=', patient.id)
        .where('mobile', '=', verification.mobile)
        .executeTakeFirstOrThrow();

      const possibleDuplicates = Number(duplicates.count);

      await this.audit.append(
        {
          actorId: context.actorId,
          actorRole: 'KIOSK',
          action: 'PATIENT_REGISTERED',
          entityType: 'patient',
          entityId: patient.id,
          correlationId: context.correlationId,
          detail: { possibleDuplicates, mobile: verification.mobile, name: request.name },
        },
        trx,
      );

      if (possibleDuplicates > 0) {
        await this.audit.append(
          {
            actorId: context.actorId,
            actorRole: 'SYSTEM',
            action: 'POSSIBLE_DUPLICATE_FLAGGED',
            entityType: 'patient',
            entityId: patient.id,
            correlationId: context.correlationId,
            detail: { possibleDuplicates },
          },
          trx,
        );
      }

      return { patient, possibleDuplicates };
    });
  }
}
