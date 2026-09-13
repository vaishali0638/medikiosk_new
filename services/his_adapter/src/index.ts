/**
 * HIS / hospital queue adapter.
 *
 * The invariant this package exists to protect: the hospital HIS is the sole authority
 * for a patient token. MediKiosk *asks* for one and reports what came back. It never
 * mints a token of its own, and it never issues a second one to paper over an uncertain
 * first request — an uncertain outcome is a question for a human, not a retry.
 */

export type HisAdapterKind = 'sandbox' | 'rest' | 'fhir' | 'hl7v2';

/** Marks the sandbox wherever it is surfaced, so it cannot be mistaken for a hospital. */
export const SANDBOX_ADAPTER_LABEL = 'LOCAL SANDBOX ADAPTER — NOT A HOSPITAL SYSTEM' as const;

export interface HisTokenRequest {
  /** `<kioskCode>-<preCheckinId>`. The HIS must treat repeats as the same request. */
  readonly idempotencyKey: string;
  readonly hospitalCode: string;
  readonly branchCode: string;
  readonly departmentCode: string;
  /** The hospital's own patient identifier, when the visit has one. */
  readonly uhid?: string | undefined;
  readonly visitType: 'NEW_COMPLAINT' | 'REGULAR_FOLLOW_UP';
  readonly appointmentRef?: string | undefined;
  readonly correlationId: string;
}

export interface HisTokenIssued {
  readonly outcome: 'ISSUED';
  /** Exactly as the HIS returned it. Never reformatted, never generated locally. */
  readonly token: string;
  readonly room?: string | undefined;
  readonly queueStatus?: string | undefined;
  readonly hisEncounterRef?: string | undefined;
}

/**
 * The HIS understood the request and declined it — a cancelled visit, an unknown
 * encounter. Definitive, so a retry under the same key is safe and pointless.
 */
export interface HisTokenRejected {
  readonly outcome: 'REJECTED';
  readonly errorCode: string;
}

/**
 * The HIS could not be reached, or answered in a way that leaves the outcome unknown —
 * a timeout after the request was accepted, a 5xx, a truncated response.
 *
 * This is NOT a failure. It is an absence of information, and the two must never be
 * conflated: treating "we do not know" as "it failed" is precisely how a patient ends up
 * holding two tokens for one visit.
 */
export interface HisTokenUncertain {
  readonly outcome: 'UNCERTAIN';
  readonly detail: string;
}

export type HisTokenResult = HisTokenIssued | HisTokenRejected | HisTokenUncertain;

/** What a status poll can tell us about a request already sent. */
export type HisStatusResult =
  | {
      readonly outcome: 'ISSUED';
      readonly token: string;
      readonly room?: string | undefined;
      readonly queueStatus?: string | undefined;
    }
  | { readonly outcome: 'NOT_FOUND' }
  | { readonly outcome: 'UNCERTAIN'; readonly detail: string };

/**
 * Replaceable hospital queue integration.
 *
 * Abstract rather than an interface so Nest can inject it by class token, and so a
 * deployment that forgets to configure one fails at the first request instead of
 * silently succeeding against nothing.
 */
export abstract class HisAdapter {
  abstract readonly kind: HisAdapterKind;

  /** Requests a token. Must be safe to call repeatedly with the same idempotency key. */
  abstract requestToken(request: HisTokenRequest): Promise<HisTokenResult>;

  /**
   * Asks whether a request already produced a token.
   *
   * This is what makes an uncertain outcome recoverable without risking a duplicate:
   * before retrying anything, ask the hospital what it already did.
   */
  abstract getTokenStatus(idempotencyKey: string, correlationId: string): Promise<HisStatusResult>;
}

export {
  EmrExportAdapter,
  SandboxEmrExportAdapter,
  UnconfiguredEmrExportAdapter,
  type EmrExportRequest,
  type EmrExportResult,
} from './export.adapter';

export {
  SandboxHisAdapter,
  UnconfiguredHisAdapter,
  type SandboxBehaviour,
} from './sandbox.adapter';
