import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import { DomainError } from '../common/domain-error';
import type { CorrelatedRequest } from '../common/correlation-id.middleware';

/** Header the patient PWA sends to name the hospital it is checking into. */
export const HOSPITAL_HEADER = 'x-hospital';

export interface PatientChannelContext {
  readonly hospitalId: string;
  readonly hospitalCode: string;
  readonly hospitalName: string;
}

export interface PatientChannelRequest extends CorrelatedRequest {
  hospital: PatientChannelContext;
}

/**
 * Scopes a patient-channel request to one hospital.
 *
 * This is the counterpart to [KioskDeviceGuard] for requests that come from a patient's
 * own phone, outside the hospital, where there is no device to identify. It resolves
 * which hospital the request is for and nothing more — it is emphatically NOT
 * authentication, and every endpoint behind it must stand on its own:
 *
 *   - the OTP endpoints answer identically for registered and unregistered numbers, and
 *     are rate-limited per number;
 *   - the consent notice is public information by design — it is what a patient reads
 *     BEFORE deciding to share anything;
 *   - creating a consent or a pre-check-in requires possession of ids the caller can only
 *     have obtained by completing the previous step.
 *
 * Nothing here reads a patient record. The endpoints that do live behind the kiosk guard.
 */
@Injectable()
export class PatientChannelGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Db) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PatientChannelRequest>();
    const code = request.header(HOSPITAL_HEADER);

    if (!code) {
      throw new DomainError('VALIDATION_FAILED', request.correlationId, 'missing hospital header');
    }

    const hospital = await this.db
      .selectFrom('hospital')
      .select(['id', 'code', 'name'])
      .where('code', '=', code)
      .executeTakeFirst();

    if (!hospital) {
      throw new DomainError('VALIDATION_FAILED', request.correlationId, `unknown hospital ${code}`);
    }

    request.hospital = {
      hospitalId: hospital.id,
      hospitalCode: hospital.code,
      hospitalName: hospital.name,
    };
    return true;
  }
}
