import type { PreCheckinState } from '@medikiosk/api-contracts';
import { StateMachine, type TransitionTable } from './state-machine';

/**
 * Mobile pre-check-in lifecycle.
 *
 * The safety-critical shape here is that TOKEN_ISSUED is reachable only through
 * ARRIVAL_CONFIRMED, which in turn requires a successful physical kiosk scan. A patient
 * who completes everything at home reaches QR_ISSUED and stops there: the hospital, not
 * the phone, decides when a token exists.
 *
 * RECONCILIATION_REQUIRED is a holding state for an uncertain HIS outcome. It can only
 * move to TOKEN_ISSUED or CANCELLED, both of which are human decisions after checking
 * the HIS — the system never resolves the ambiguity by issuing another token.
 */
const transitions: TransitionTable<PreCheckinState> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['QR_ISSUED', 'CANCELLED'],
  // A fresh QR may be issued while the pre-check-in is still valid (the patient closed
  // the app, the code scrolled off screen). Re-issuing invalidates the previous nonce.
  QR_ISSUED: ['QR_ISSUED', 'ARRIVAL_CONFIRMED', 'QR_EXPIRED', 'CANCELLED'],
  QR_EXPIRED: ['QR_ISSUED', 'CANCELLED'],
  ARRIVAL_CONFIRMED: ['TOKEN_REQUESTED', 'CANCELLED'],
  TOKEN_REQUESTED: ['TOKEN_ISSUED', 'RECONCILIATION_REQUIRED', 'CANCELLED'],
  TOKEN_ISSUED: ['CONSUMED'],
  RECONCILIATION_REQUIRED: ['TOKEN_ISSUED', 'CANCELLED'],
  CONSUMED: [],
  CANCELLED: [],
};

export const preCheckinMachine = new StateMachine<PreCheckinState>(
  'PreCheckin',
  'DRAFT',
  transitions,
);
