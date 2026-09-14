import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { KIOSK_DEVICE_HEADER } from '@medikiosk/api-contracts';
import { sql } from 'kysely';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import { DomainError } from '../common/domain-error';
import type { CorrelatedRequest } from '../common/correlation-id.middleware';

/** Resolved device context attached to the request. */
export interface KioskContext {
  readonly deviceId: string;
  readonly deviceCode: string;
  readonly branchId: string;
  readonly hospitalId: string;
}

export interface KioskRequest extends CorrelatedRequest {
  kiosk: KioskContext;
}

/**
 * Resolves the calling kiosk from its device code and rejects unknown or disabled devices.
 *
 * This is identification, not authentication: the header is not a secret, and a device
 * code printed on an enclosure is guessable. Phase 15 adds mutual-TLS client certificates,
 * for which `kiosk_device.cert_fingerprint` already exists. Until then this guard limits
 * the surface to devices the hospital has actually registered and left enabled, which is
 * why a disabled device is refused rather than merely logged — disabling a stolen kiosk in
 * the MDM must take it out of service immediately.
 */
@Injectable()
export class KioskDeviceGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Db) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<KioskRequest>();
    const correlationId = request.correlationId;
    const code = request.header(KIOSK_DEVICE_HEADER);

    if (!code) {
      throw new DomainError('VALIDATION_FAILED', correlationId, 'missing kiosk device header');
    }

    const device = await this.db
      .selectFrom('kiosk_device')
      .innerJoin('branch', 'branch.id', 'kiosk_device.branch_id')
      .select([
        'kiosk_device.id as deviceId',
        'kiosk_device.code as deviceCode',
        'kiosk_device.enabled as enabled',
        'branch.id as branchId',
        'branch.hospital_id as hospitalId',
      ])
      .where('kiosk_device.code', '=', code)
      .executeTakeFirst();

    // Unknown and disabled produce the same client-visible outcome, so probing device
    // codes cannot be used to enumerate which kiosks exist.
    if (!device || !device.enabled) {
      throw new DomainError(
        'VALIDATION_FAILED',
        correlationId,
        device ? `kiosk device disabled: ${code}` : `unknown kiosk device: ${code}`,
      );
    }

    request.kiosk = {
      deviceId: device.deviceId,
      deviceCode: device.deviceCode,
      branchId: device.branchId,
      hospitalId: device.hospitalId,
    };

    // Liveness for the operations dashboard. Best-effort in the sense that a failure must
    // not stop a patient from checking in — but awaited, not fired and forgotten.
    //
    // It used to be `void`-ed. That left an uncommitted UPDATE holding a row lock on
    // kiosk_device after the response had already gone out, racing whatever ran next. In
    // the integration suite "whatever ran next" is a TRUNCATE, which needs ACCESS
    // EXCLUSIVE on the same table and, with lock_timeout at its default of 0, waits for
    // it forever. In an OPD it would be the next patient's request queueing behind a write
    // nobody is waiting for. An unawaited write is not free just because no one reads it.
    //
    // The throttle is what makes awaiting cheap: past the first request in a minute the
    // WHERE matches nothing, so the statement takes no row lock at all.
    await this.db
      .updateTable('kiosk_device')
      .set({ last_seen_at: sql<Date>`now()` })
      .where('id', '=', device.deviceId)
      .where((eb) =>
        eb.or([
          eb('last_seen_at', 'is', null),
          eb('last_seen_at', '<', sql<Date>`now() - interval '60 seconds'`),
        ]),
      )
      .execute()
      .catch(() => undefined);

    return true;
  }
}
