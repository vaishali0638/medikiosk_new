import {
  HisAdapter,
  SANDBOX_ADAPTER_LABEL,
  type HisAdapterKind,
  type HisStatusResult,
  type HisTokenRequest,
  type HisTokenResult,
} from './index';

/** Per-department counters, so sandbox tokens look like real queue numbers. */
interface SandboxState {
  readonly issued: Map<string, { token: string; room: string; queueStatus: string }>;
  readonly counters: Map<string, number>;
}

export interface SandboxBehaviour {
  /** Force an outcome, for exercising the reconciliation paths in development. */
  readonly forceOutcome?: 'ISSUED' | 'REJECTED' | 'UNCERTAIN';
  /** Artificial latency, to make the kiosk's waiting state visible. */
  readonly latencyMs?: number;
}

/**
 * Development stand-in for a hospital queue.
 *
 * It is genuinely idempotent — the same key returns the same token — because that is the
 * property the rest of the system is built on, and a sandbox that did not honour it would
 * hide exactly the bug it should surface.
 *
 * `assertProductionAdapters` refuses to boot with this in production: a token issued by
 * a counter in a Node process is not a hospital token, and a patient holding one would be
 * queued nowhere.
 */
export class SandboxHisAdapter extends HisAdapter {
  readonly kind: HisAdapterKind = 'sandbox';
  readonly label = SANDBOX_ADAPTER_LABEL;

  private readonly state: SandboxState = { issued: new Map(), counters: new Map() };

  constructor(private readonly behaviour: SandboxBehaviour = {}) {
    super();
  }

  async requestToken(request: HisTokenRequest): Promise<HisTokenResult> {
    if (this.behaviour.latencyMs) await delay(this.behaviour.latencyMs);

    // Idempotency first, before any forced outcome: a key that already produced a token
    // must keep returning it, exactly as a real HIS would.
    const existing = this.state.issued.get(request.idempotencyKey);
    if (existing) {
      return { outcome: 'ISSUED', ...existing, hisEncounterRef: `SBX-${request.idempotencyKey}` };
    }

    if (this.behaviour.forceOutcome === 'REJECTED') {
      return { outcome: 'REJECTED', errorCode: 'SANDBOX_FORCED_REJECTION' };
    }
    if (this.behaviour.forceOutcome === 'UNCERTAIN') {
      return { outcome: 'UNCERTAIN', detail: 'sandbox forced an uncertain outcome' };
    }

    const prefix = departmentPrefix(request.departmentCode);
    const next = (this.state.counters.get(prefix) ?? 0) + 1;
    this.state.counters.set(prefix, next);

    const issued = {
      token: `${prefix}-${String(next).padStart(4, '0')}`,
      room: String((next % 4) + 1),
      queueStatus: 'Waiting',
    };
    this.state.issued.set(request.idempotencyKey, issued);

    return { outcome: 'ISSUED', ...issued, hisEncounterRef: `SBX-${request.idempotencyKey}` };
  }

  async getTokenStatus(idempotencyKey: string): Promise<HisStatusResult> {
    const existing = this.state.issued.get(idempotencyKey);
    return existing ? { outcome: 'ISSUED', ...existing } : { outcome: 'NOT_FOUND' };
  }

  /** Test seam: pretend the HIS issued a token we never heard about. */
  seedIssued(idempotencyKey: string, token: string, room = '1'): void {
    this.state.issued.set(idempotencyKey, { token, room, queueStatus: 'Waiting' });
  }
}

/** `AYU-OPD` -> `AYU`. Mirrors how Indian OPD queue numbers are usually formatted. */
function departmentPrefix(departmentCode: string): string {
  const head = departmentCode.split('-')[0] ?? departmentCode;
  return head.slice(0, 4).toUpperCase();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Placeholder for a real hospital integration.
 *
 * Throws rather than returning UNCERTAIN. An unconfigured deployment is a deployment
 * mistake, not an ambiguous hospital response, and dressing it up as one would fill the
 * reconciliation queue with items no human can resolve.
 */
export class UnconfiguredHisAdapter extends HisAdapter {
  readonly kind: HisAdapterKind = 'rest';

  async requestToken(): Promise<HisTokenResult> {
    throw new Error(
      'No HIS adapter is configured. Set HIS_ADAPTER and HIS_BASE_URL, or the kiosk cannot ' +
        'obtain hospital tokens.',
    );
  }

  async getTokenStatus(): Promise<HisStatusResult> {
    throw new Error('No HIS adapter is configured.');
  }
}
