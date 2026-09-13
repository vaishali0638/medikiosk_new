import { Inject, Injectable, Logger } from '@nestjs/common';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import { redact } from '../common/redact';

export const DEVICE_EVENT_KINDS = [
  'APP_CRASH',
  'APP_STARTED',
  'NETWORK_LOST',
  'NETWORK_RESTORED',
  'UPLOAD_FAILED',
  'PRINTER_FAULT',
  'PRINTER_OK',
  'SCANNER_FAULT',
  'LOCKDOWN_DEGRADED',
] as const;

export type DeviceEventKind = (typeof DEVICE_EVENT_KINDS)[number];

@Injectable()
export class DeviceEventsService {
  private readonly logger = new Logger(DeviceEventsService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Records something only the device knows.
   *
   * The detail is redacted before it is written, with the same function the audit trail
   * uses. A crash report is exactly the kind of payload that arrives carrying a stack
   * frame with a patient's name in a local variable, and a kiosk sending its own telemetry
   * is not a reason to relax the rule that operational data holds no clinical content.
   *
   * Never rejects on an unexpected payload beyond the schema: telemetry that fails closed
   * loses the report of the crash that caused it.
   */
  async record(input: {
    kioskDeviceId: string;
    kind: DeviceEventKind;
    detail?: Record<string, unknown> | undefined;
    kioskSessionId?: string | undefined;
    occurredAt?: Date | undefined;
    correlationId: string;
  }): Promise<void> {
    await this.db
      .insertInto('device_event')
      .values({
        kiosk_device_id: input.kioskDeviceId,
        kind: input.kind,
        detail: JSON.stringify(redact(input.detail ?? {})) as never,
        kiosk_session_id: input.kioskSessionId ?? null,
        // The device's own clock for when it happened, the server's for when it arrived.
        // A kiosk that was offline reports late, and the gap between the two is itself
        // information about the outage.
        ...(input.occurredAt ? { occurred_at: input.occurredAt } : {}),
        correlation_id: input.correlationId,
      })
      .execute();

    if (input.kind === 'APP_CRASH' || input.kind === 'LOCKDOWN_DEGRADED') {
      this.logger.warn(`device reported ${input.kind} correlationId=${input.correlationId}`);
    }
  }

  /** Recent events for the operations view, newest first. */
  async recent(limit = 100): Promise<unknown[]> {
    return this.db
      .selectFrom('device_event')
      .innerJoin('kiosk_device', 'kiosk_device.id', 'device_event.kiosk_device_id')
      .select([
        'device_event.kind as kind',
        'device_event.detail as detail',
        'device_event.occurred_at as occurredAt',
        'device_event.reported_at as reportedAt',
        'kiosk_device.code as kioskCode',
      ])
      .orderBy('device_event.occurred_at', 'desc')
      .limit(limit)
      .execute();
  }
}
