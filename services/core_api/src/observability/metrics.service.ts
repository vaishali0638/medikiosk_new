import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';

/** How long a kiosk may be silent before it counts as offline. */
export const KIOSK_OFFLINE_AFTER_SECONDS = 10 * 60;

export interface MetricSample {
  readonly name: string;
  readonly help: string;
  readonly type: 'gauge' | 'counter';
  readonly value: number;
  readonly labels?: Readonly<Record<string, string>>;
}

/**
 * Operational figures, gathered from the database.
 *
 * Everything here is a COUNT or a RATE. Nothing carries a patient id, a mobile number, a
 * document, or any clinical text — a metrics endpoint is scraped every fifteen seconds and
 * ends up in a time-series database that is not covered by the consent a patient gave, so
 * the rule is that it may say how many and never who.
 *
 * Computed on demand rather than kept as in-process counters. Counters in memory are lost
 * on restart and are wrong the moment there are two instances; the database already knows
 * the answers and is the only place both instances agree.
 */
@Injectable()
export class MetricsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async collect(): Promise<MetricSample[]> {
    const [devices, queues, outcomes, sessions, documents] = await Promise.all([
      this.kioskStatus(),
      this.queueDepths(),
      this.integrationOutcomes(),
      this.sessionOutcomes(),
      this.documentOutcomes(),
    ]);
    return [...devices, ...queues, ...outcomes, ...sessions, ...documents];
  }

  /** Online, offline and disabled kiosks. The first alert any hospital wants. */
  private async kioskStatus(): Promise<MetricSample[]> {
    const rows = await this.db
      .selectFrom('kiosk_device')
      .select(({ fn }) => [
        fn.countAll<string>().as('total'),
        sql<string>`count(*) FILTER (WHERE enabled = false)`.as('disabled'),
        sql<string>`count(*) FILTER (
          WHERE enabled = true
            AND (last_seen_at IS NULL
                 OR last_seen_at < now() - make_interval(secs => ${KIOSK_OFFLINE_AFTER_SECONDS}))
        )`.as('offline'),
      ])
      .executeTakeFirstOrThrow();

    const total = Number(rows.total);
    const disabled = Number(rows.disabled);
    const offline = Number(rows.offline);

    return [
      gauge('medikiosk_kiosk_total', 'Provisioned kiosk devices.', total),
      gauge('medikiosk_kiosk_disabled', 'Kiosks disabled by an operator.', disabled),
      gauge(
        'medikiosk_kiosk_offline',
        `Enabled kiosks not seen for ${KIOSK_OFFLINE_AFTER_SECONDS}s.`,
        offline,
      ),
      gauge('medikiosk_kiosk_online', 'Enabled kiosks seen recently.', total - disabled - offline),
    ];
  }

  /** Work waiting to be done. Depth that grows without bound is the signal. */
  private async queueDepths(): Promise<MetricSample[]> {
    const ocr = await this.db
      .selectFrom('ocr_extraction')
      .select(() => [
        sql<string>`count(*) FILTER (WHERE review_state = 'PENDING')`.as('pending'),
        sql<string>`count(*) FILTER (WHERE review_state = 'AWAITING_CLINICIAN_REVIEW')`.as(
          'awaitingReview',
        ),
        sql<string>`count(*) FILTER (WHERE review_state = 'FAILED')`.as('failed'),
      ])
      .executeTakeFirstOrThrow();

    const outbox = await this.db
      .selectFrom('integration_outbox')
      .select(() => [sql<string>`count(*) FILTER (WHERE state = 'PENDING')`.as('pending')])
      .executeTakeFirstOrThrow();

    return [
      gauge('medikiosk_ocr_queue_depth', 'Extractions waiting for a worker.', Number(ocr.pending)),
      gauge(
        'medikiosk_ocr_awaiting_clinician',
        'Extractions waiting for a clinician to verify them.',
        Number(ocr.awaitingReview),
      ),
      gauge(
        'medikiosk_ocr_failed',
        'Extractions that gave up. The original is still kept.',
        Number(ocr.failed),
      ),
      gauge(
        'medikiosk_outbox_pending',
        'Integration outbox items not yet delivered.',
        Number(outbox.pending),
      ),
    ];
  }

  /** HIS and EMR outcomes, including the ones a human has to resolve. */
  private async integrationOutcomes(): Promise<MetricSample[]> {
    const tokens = await this.db
      .selectFrom('token_request')
      .select(() => [
        sql<string>`count(*) FILTER (WHERE state = 'ISSUED')`.as('issued'),
        sql<string>`count(*) FILTER (WHERE state = 'FAILED')`.as('failed'),
        sql<string>`count(*) FILTER (WHERE state = 'UNKNOWN_RECONCILIATION_REQUIRED')`.as(
          'reconciliation',
        ),
      ])
      .executeTakeFirstOrThrow();

    const exports = await this.db
      .selectFrom('encounter_export')
      .select(() => [
        sql<string>`count(*) FILTER (WHERE state = 'ACKNOWLEDGED')`.as('acknowledged'),
        sql<string>`count(*) FILTER (WHERE state = 'FAILED')`.as('failed'),
        sql<string>`count(*) FILTER (WHERE state = 'RECONCILIATION_REQUIRED')`.as('reconciliation'),
      ])
      .executeTakeFirstOrThrow();

    return [
      counter('medikiosk_token_issued_total', 'Hospital tokens issued.', Number(tokens.issued)),
      counter(
        'medikiosk_token_failed_total',
        'Token requests the HIS refused.',
        Number(tokens.failed),
      ),
      gauge(
        'medikiosk_token_reconciliation_required',
        'Token requests with an unknown outcome, awaiting a human.',
        Number(tokens.reconciliation),
      ),
      counter(
        'medikiosk_export_acknowledged_total',
        'Records the EMR accepted.',
        Number(exports.acknowledged),
      ),
      counter('medikiosk_export_failed_total', 'Records the EMR refused.', Number(exports.failed)),
      gauge(
        'medikiosk_export_reconciliation_required',
        'Exports with an unknown outcome, awaiting a human.',
        Number(exports.reconciliation),
      ),
    ];
  }

  /**
   * How patients actually fare at the kiosk.
   *
   * Completion, exit and timeout rates are the numbers that say whether the thing works for
   * the people using it, as opposed to whether the servers are up. A rising exit rate is a
   * usability failure long before it is an outage.
   */
  private async sessionOutcomes(): Promise<MetricSample[]> {
    const rows = await this.db
      .selectFrom('kiosk_session')
      .select(() => [
        sql<string>`count(*)`.as('total'),
        sql<string>`count(*) FILTER (WHERE state = 'TOKEN_ISSUED')`.as('completed'),
        sql<string>`count(*) FILTER (WHERE state = 'EXITED')`.as('exited'),
        sql<string>`count(*) FILTER (WHERE state = 'EXPIRED')`.as('expired'),
        sql<string>`count(*) FILTER (WHERE state = 'ERROR')`.as('errored'),
        sql<string>`count(*) FILTER (WHERE ended_at IS NOT NULL AND wiped_at IS NULL)`.as(
          'endedUnwiped',
        ),
      ])
      .where('started_at', '>', sql<Date>`now() - interval '24 hours'`)
      .executeTakeFirstOrThrow();

    return [
      counter(
        'medikiosk_sessions_started_total',
        'Kiosk sessions started in 24h.',
        Number(rows.total),
      ),
      counter(
        'medikiosk_sessions_completed_total',
        'Sessions that reached a token.',
        Number(rows.completed),
      ),
      counter('medikiosk_sessions_exited_total', 'Sessions a patient exited.', Number(rows.exited)),
      counter('medikiosk_sessions_expired_total', 'Sessions that timed out.', Number(rows.expired)),
      counter(
        'medikiosk_sessions_errored_total',
        'Sessions that ended in an error.',
        Number(rows.errored),
      ),
      // A session that ended without the device attesting to a wipe. Should be zero, and a
      // non-zero value is a privacy fault rather than a performance one.
      gauge(
        'medikiosk_sessions_ended_without_wipe',
        'Sessions that ended with no wipe attestation. Should be zero.',
        Number(rows.endedUnwiped),
      ),
    ];
  }

  private async documentOutcomes(): Promise<MetricSample[]> {
    const rows = await this.db
      .selectFrom('document')
      .select(() => [
        sql<string>`count(*) FILTER (WHERE state = 'STORED')`.as('stored'),
        sql<string>`count(*) FILTER (WHERE state = 'REJECTED_MALWARE')`.as('malware'),
        sql<string>`count(*) FILTER (WHERE state = 'REJECTED_INVALID')`.as('invalid'),
      ])
      .executeTakeFirstOrThrow();

    return [
      counter(
        'medikiosk_documents_stored_total',
        'Documents accepted and encrypted.',
        Number(rows.stored),
      ),
      // Worth its own series: a cluster of these at one kiosk is somebody probing the
      // uploader, not a patient with an unusual file.
      counter(
        'medikiosk_documents_rejected_malware_total',
        'Uploads a scanner refused.',
        Number(rows.malware),
      ),
      counter(
        'medikiosk_documents_rejected_invalid_total',
        'Uploads that failed validation.',
        Number(rows.invalid),
      ),
    ];
  }
}

function gauge(name: string, help: string, value: number): MetricSample {
  return { name, help, type: 'gauge', value };
}

function counter(name: string, help: string, value: number): MetricSample {
  return { name, help, type: 'counter', value };
}

/** Prometheus text exposition format. */
export function renderPrometheus(samples: readonly MetricSample[]): string {
  const lines: string[] = [];
  for (const sample of samples) {
    lines.push(`# HELP ${sample.name} ${sample.help}`);
    lines.push(`# TYPE ${sample.name} ${sample.type}`);
    const labels = sample.labels
      ? `{${Object.entries(sample.labels)
          .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
          .join(',')}}`
      : '';
    lines.push(`${sample.name}${labels} ${sample.value}`);
  }
  return `${lines.join('\n')}\n`;
}
