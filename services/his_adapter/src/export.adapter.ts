/**
 * Export of a confirmed clinical record to the hospital's EMR.
 *
 * Deliberately separate from `HisAdapter`. A token is a queue position: if one is lost the
 * patient waits and asks again. A clinical record is the note a future clinician treats
 * from, and a duplicate of it is a second version of the truth that somebody has to
 * reconcile by hand. Same hospital, same network, very different consequences for getting
 * a retry wrong — so they do not share a retry policy or an interface.
 */

export interface EmrExportRequest {
  /** Derived from the encounter, never supplied by a caller, so every retry converges. */
  readonly idempotencyKey: string;
  readonly hospitalCode: string;
  readonly uhid: string | undefined;
  readonly encounterRef: string | undefined;
  readonly departmentCode: string;
  /** Who signed it. The EMR records the clinician, not MediKiosk. */
  readonly clinicianRef: string;
  readonly verifiedAt: string;
  /** The confirmed record. Structured; the adapter maps it to the hospital's format. */
  readonly record: unknown;
  readonly correlationId: string;
}

export type EmrExportResult =
  | { readonly outcome: 'ACCEPTED'; readonly hisRecordRef: string }
  | { readonly outcome: 'REJECTED'; readonly errorCode: string; readonly detail: string }
  | { readonly outcome: 'UNCERTAIN'; readonly detail: string };

export abstract class EmrExportAdapter {
  abstract readonly kind: string;

  /** Must be safe to call repeatedly with the same idempotency key. */
  abstract exportRecord(request: EmrExportRequest): Promise<EmrExportResult>;

  /**
   * Asks whether an export already landed.
   *
   * The same reasoning as token status: before retrying anything after an uncertain
   * outcome, ask the hospital what it already has. A blind retry is how a patient's note
   * appears twice.
   */
  abstract getExportStatus(
    idempotencyKey: string,
    correlationId: string,
  ): Promise<EmrExportResult | { readonly outcome: 'NOT_FOUND' }>;
}

/** Development adapter. Records what it was given and answers consistently. */
export class SandboxEmrExportAdapter extends EmrExportAdapter {
  readonly kind = 'sandbox';
  private readonly accepted = new Map<string, string>();

  /** Set by a test to make the next call behave badly. */
  next: 'ACCEPT' | 'REJECT' | 'UNCERTAIN' = 'ACCEPT';

  async exportRecord(request: EmrExportRequest): Promise<EmrExportResult> {
    const existing = this.accepted.get(request.idempotencyKey);
    // Idempotent at the adapter too, mirroring what a real HIS with an idempotency key
    // does: the same key returns the same reference rather than creating a second record.
    if (existing) return { outcome: 'ACCEPTED', hisRecordRef: existing };

    if (this.next === 'REJECT') {
      return { outcome: 'REJECTED', errorCode: 'EMR_VALIDATION', detail: 'sandbox rejection' };
    }
    if (this.next === 'UNCERTAIN') {
      // Recorded anyway: an uncertain outcome means the hospital may well have accepted
      // it, and a status query afterwards must find it. That is the whole scenario.
      const ref = `EMR-${request.idempotencyKey.slice(0, 8)}`;
      this.accepted.set(request.idempotencyKey, ref);
      return { outcome: 'UNCERTAIN', detail: 'sandbox timeout' };
    }

    const ref = `EMR-${request.idempotencyKey.slice(0, 8)}`;
    this.accepted.set(request.idempotencyKey, ref);
    return { outcome: 'ACCEPTED', hisRecordRef: ref };
  }

  async getExportStatus(
    idempotencyKey: string,
  ): Promise<EmrExportResult | { readonly outcome: 'NOT_FOUND' }> {
    const ref = this.accepted.get(idempotencyKey);
    return ref ? { outcome: 'ACCEPTED', hisRecordRef: ref } : { outcome: 'NOT_FOUND' };
  }
}

/** The default. A deployment with no configured EMR exports nothing, loudly. */
export class UnconfiguredEmrExportAdapter extends EmrExportAdapter {
  readonly kind = 'unconfigured';

  async exportRecord(): Promise<EmrExportResult> {
    return {
      outcome: 'REJECTED',
      errorCode: 'EMR_NOT_CONFIGURED',
      detail: 'no EMR export adapter is configured',
    };
  }

  async getExportStatus(): Promise<{ readonly outcome: 'NOT_FOUND' }> {
    return { outcome: 'NOT_FOUND' };
  }
}
