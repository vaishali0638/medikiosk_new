/**
 * HIS / hospital queue adapter.
 *
 * PHASE 7 implements this. The invariant it exists to protect, recorded here so it is
 * not lost between phases: the hospital HIS/queue is the sole authority for a final
 * patient token. MediKiosk *requests* a token and reports what the HIS returned; it
 * never mints an independent production token, and never issues a second token to
 * paper over an uncertain first request.
 */

/** Adapter selection, mirroring the HIS_ADAPTER environment value. */
export type HisAdapterKind = 'sandbox' | 'rest' | 'fhir' | 'hl7v2';

/** Marks the sandbox as a development stand-in wherever it is surfaced. */
export const SANDBOX_ADAPTER_LABEL = 'LOCAL SANDBOX ADAPTER — NOT A HOSPITAL SYSTEM' as const;
