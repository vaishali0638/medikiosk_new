import type { PreCheckinState } from '@medikiosk/api-contracts';
import { StateMachine, type TransitionTable } from './state-machine';

/**
 * Mobile pre-check-in lifecycle.
 *
 * The safety-critical shape here is that TOKEN_ISSUED is reachable only through
 * ARRIVAL_CONFIRMED, which in turn requires the patient to be physically at a kiosk. A
 * patient who completes everything at home reaches QR_ISSUED and stops there: the
 * hospital, not the phone, decides when a token exists.
 *
 * There are two ways to reach ARRIVAL_CONFIRMED, because there are two ways to arrive.
 * QR_ISSUED -> ARRIVAL_CONFIRMED is the mobile patient, proven by a scan that consumes a
 * single-use nonce. SUBMITTED -> ARRIVAL_CONFIRMED is the walk-in, who never had a QR and
 * whose presence is proven by the fact that the intake was conducted on the kiosk itself.
 *
 * That second edge is the one to be careful about: on its own it would let a mobile
 * pre-check-in reach a token without ever being scanned. The table cannot express the
 * difference, so the control is in `KioskVisitService.confirmWalkInArrival`, which
 * refuses any visit that was not opened by a kiosk session. A transition table says what
 * order things may happen in; it cannot say who is allowed to ask.
 *
 * RECONCILIATION_REQUIRED is a holding state for an uncertain HIS outcome. It can only
 * move to TOKEN_ISSUED or CANCELLED, both of which are human decisions after checking
 * the HIS — the system never resolves the ambiguity by issuing another token.
 */
const transitions: TransitionTable<PreCheckinState> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['QR_ISSUED', 'ARRIVAL_CONFIRMED', 'CANCELLED'],
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
