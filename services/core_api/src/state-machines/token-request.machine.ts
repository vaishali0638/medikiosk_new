import type { TokenRequestState } from '@medikiosk/api-contracts';
import { StateMachine, type TransitionTable } from './state-machine';

/**
 * HIS token request lifecycle.
 *
 * The table encodes the single most important rule in the product: MediKiosk never
 * issues an independent token. ISSUED is terminal and unreachable except from a HIS
 * response, and there is no edge from ISSUED back to REQUESTED — once the hospital has
 * given this visit a token, no retry path can produce a second one.
 *
 * FAILED means the HIS definitively refused, so a fresh attempt under the same
 * idempotency key is safe. UNKNOWN_RECONCILIATION_REQUIRED means we do not know whether
 * the HIS acted; it is terminal for the automated path and only a human, having checked
 * the HIS directly, records the outcome.
 */
const transitions: TransitionTable<TokenRequestState> = {
  NOT_STARTED: ['REQUESTED'],
  REQUESTED: ['ACKNOWLEDGED', 'ISSUED', 'FAILED', 'UNKNOWN_RECONCILIATION_REQUIRED'],
  ACKNOWLEDGED: ['ISSUED', 'FAILED', 'UNKNOWN_RECONCILIATION_REQUIRED'],
  ISSUED: [],
  // A definitive failure may be retried; the idempotency key stays the same.
  FAILED: ['REQUESTED'],
  UNKNOWN_RECONCILIATION_REQUIRED: [],
};

export const tokenRequestMachine = new StateMachine<TokenRequestState>(
  'TokenRequest',
  'NOT_STARTED',
  transitions,
);
