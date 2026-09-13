import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import { KIOSK_OFFLINE_AFTER_SECONDS } from './metrics.service';

export type AlertSeverity = 'CRITICAL' | 'WARNING';

export interface Alert {
  readonly name: string;
  readonly severity: AlertSeverity;
  /** What is wrong, in a sentence someone woken by it can act on. */
  readonly summary: string;
  readonly value: number;
  readonly threshold: number;
  /** The runbook that says what to do. Every alert has one, by construction. */
  readonly runbook: string;
}

/**
 * Alert definitions, each with a runbook.
 *
 * The runbook is a required field rather than a convention, because an alert with no
 * instructions is a 2am page that begins with the recipient reading source code. If a
 * condition is worth waking someone for, somebody has to have written down what they should
 * do — and if nobody can write that down, the alert should not exist.
 *
 * Thresholds are deliberately conservative. An alerting system people learn to ignore is
 * worse than none, because it also hides the real one.
 */
@Injectable()
export class AlertsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async evaluate(): Promise<Alert[]> {
    const alerts: Alert[] = [];

    // A kiosk nobody can use is invisible from the server unless somebody looks. This is
    // the alert a hospital actually wants: a machine standing dark in a corridor.
    const offline = await this.db
      .selectFrom('kiosk_device')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('enabled', '=', true)
      .where((eb) =>
        eb.or([
          eb('last_seen_at', 'is', null),
          eb(
            'last_seen_at',
            '<',
            sql<Date>`now() - make_interval(secs => ${KIOSK_OFFLINE_AFTER_SECONDS})`,
          ),
        ]),
      )
      .executeTakeFirstOrThrow();

    if (Number(offline.count) > 0) {
      alerts.push({
        name: 'KioskOffline',
        severity: 'CRITICAL',
        summary: `${offline.count} enabled kiosk(s) have not been seen for ${
          KIOSK_OFFLINE_AFTER_SECONDS / 60
        } minutes.`,
        value: Number(offline.count),
        threshold: 0,
        runbook: 'docs/runbooks/alerts.md#kioskoffline',
      });
    }

    // Someone has a token the hospital may or may not know about. Every one of these is a
    // patient who will be told to see the counter, so the queue must not accumulate.
    const reconciliation = await this.db
      .selectFrom('token_request')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('state', '=', 'UNKNOWN_RECONCILIATION_REQUIRED')
      .executeTakeFirstOrThrow();

    if (Number(reconciliation.count) > 0) {
      alerts.push({
        name: 'TokenReconciliationRequired',
        severity: 'CRITICAL',
        summary: `${reconciliation.count} token request(s) have an unknown outcome.`,
        value: Number(reconciliation.count),
        threshold: 0,
        runbook: 'docs/runbooks/qr-token-failures.md',
      });
    }

    const exportsStuck = await this.db
      .selectFrom('encounter_export')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('state', '=', 'RECONCILIATION_REQUIRED')
      .executeTakeFirstOrThrow();

    if (Number(exportsStuck.count) > 0) {
      alerts.push({
        name: 'ExportReconciliationRequired',
        severity: 'CRITICAL',
        summary: `${exportsStuck.count} clinical record export(s) have an unknown outcome.`,
        value: Number(exportsStuck.count),
        threshold: 0,
        runbook: 'docs/runbooks/alerts.md#exportreconciliationrequired',
      });
    }

    // A cluster of refused uploads at one kiosk is somebody probing the uploader, not a
    // patient with an unusual file.
    const malware = await this.db
      .selectFrom('document')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('state', '=', 'REJECTED_MALWARE')
      .where('uploaded_at', '>', sql<Date>`now() - interval '1 hour'`)
      .executeTakeFirstOrThrow();

    if (Number(malware.count) >= 3) {
      alerts.push({
        name: 'RepeatedMalwareUploads',
        severity: 'WARNING',
        summary: `${malware.count} uploads refused by the malware scanner in the last hour.`,
        value: Number(malware.count),
        threshold: 3,
        runbook: 'docs/runbooks/alerts.md#repeatedmalwareuploads',
      });
    }

    // Repeated QR failures: someone trying stolen or forged codes. Individually every
    // refusal is correct and silent, which is exactly why the pattern needs surfacing.
    const qrFailures = await this.db
      .selectFrom('audit_event')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      // Exact match, not LIKE. The action is `ARRIVAL_QR_REFUSED`, and `_` is a LIKE
      // wildcard — a pattern here would have been both wrong and quietly over-broad.
      .where('action', '=', 'ARRIVAL_QR_REFUSED')
      .where('occurred_at', '>', sql<Date>`now() - interval '15 minutes'`)
      .executeTakeFirstOrThrow();

    if (Number(qrFailures.count) >= 10) {
      alerts.push({
        name: 'RepeatedQrFailures',
        severity: 'WARNING',
        summary: `${qrFailures.count} QR check-ins refused in 15 minutes.`,
        value: Number(qrFailures.count),
        threshold: 10,
        runbook: 'docs/runbooks/alerts.md#repeatedqrfailures',
      });
    }

    // Break-glass is legitimate and rare. A burst of it is the signal.
    const breakGlass = await this.db
      .selectFrom('break_glass_access')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('accessed_at', '>', sql<Date>`now() - interval '24 hours'`)
      .executeTakeFirstOrThrow();

    if (Number(breakGlass.count) >= 5) {
      alerts.push({
        name: 'UnusualAccessPattern',
        severity: 'WARNING',
        summary: `${breakGlass.count} break-glass accesses in 24 hours.`,
        value: Number(breakGlass.count),
        threshold: 5,
        runbook: 'docs/runbooks/alerts.md#unusualaccesspattern',
      });
    }

    // A session that ended with no wipe attestation. This is a privacy fault, not a
    // performance one, and it means a patient's data may still be on a device.
    const unwiped = await this.db
      .selectFrom('kiosk_session')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('ended_at', 'is not', null)
      .where('wiped_at', 'is', null)
      .where('ended_at', '>', sql<Date>`now() - interval '24 hours'`)
      .executeTakeFirstOrThrow();

    if (Number(unwiped.count) > 0) {
      alerts.push({
        name: 'SessionEndedWithoutWipe',
        severity: 'CRITICAL',
        summary: `${unwiped.count} session(s) ended without the device confirming a wipe.`,
        value: Number(unwiped.count),
        threshold: 0,
        runbook: 'docs/runbooks/alerts.md#sessionendedwithoutwipe',
      });
    }

    // Device-reported faults. The kiosk is the only thing that knows its printer is out of
    // paper, and a patient standing at a machine that cannot print is a real problem.
    const faults = await this.db
      .selectFrom('device_event')
      .innerJoin('kiosk_device', 'kiosk_device.id', 'device_event.kiosk_device_id')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('device_event.kind', 'in', ['PRINTER_FAULT', 'SCANNER_FAULT'])
      .where('device_event.occurred_at', '>', sql<Date>`now() - interval '1 hour'`)
      .executeTakeFirstOrThrow();

    if (Number(faults.count) > 0) {
      alerts.push({
        name: 'DeviceHardwareFault',
        severity: 'WARNING',
        summary: `${faults.count} printer or scanner fault(s) reported in the last hour.`,
        value: Number(faults.count),
        threshold: 0,
        runbook: 'docs/runbooks/alerts.md#devicehardwarefault',
      });
    }

    const crashes = await this.db
      .selectFrom('device_event')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('kind', '=', 'APP_CRASH')
      .where('occurred_at', '>', sql<Date>`now() - interval '1 hour'`)
      .executeTakeFirstOrThrow();

    if (Number(crashes.count) >= 3) {
      alerts.push({
        name: 'RepeatedAppCrashes',
        severity: 'CRITICAL',
        summary: `${crashes.count} kiosk app crashes in the last hour.`,
        value: Number(crashes.count),
        threshold: 3,
        runbook: 'docs/runbooks/alerts.md#repeatedappcrashes',
      });
    }

    return alerts;
  }
}
