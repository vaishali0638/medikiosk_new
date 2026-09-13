import type { KioskSessionState } from '@medikiosk/api-contracts';
import { StateMachine, type TransitionTable } from './state-machine';

/**
 * Kiosk session lifecycle.
 *
 * Three properties this table enforces:
 *
 * 1. Consent gates clinical intake. There is no edge into INTAKE_IN_PROGRESS that does
 *    not pass through CONSENT_GRANTED, so declining consent cannot be stepped around.
 * 2. Review is mandatory. SUBMITTED is reachable only from REVIEW_PENDING — a patient
 *    always sees their own information before it goes to the hospital.
 * 3. Every non-terminal state can reach EXITED and EXPIRED. Exit is available on every
 *    active screen, and an abandoned session must always be able to time out and wipe.
 */
const transitions: TransitionTable<KioskSessionState> = {
  CREATED: ['LANGUAGE_SELECTED', 'EXITED', 'EXPIRED', 'ERROR'],
  LANGUAGE_SELECTED: ['CONSENT_PENDING', 'EXITED', 'EXPIRED', 'ERROR'],
  CONSENT_PENDING: ['CONSENT_GRANTED', 'EXITED', 'EXPIRED', 'ERROR'],
  // A declined consent does not get its own state here: it ends the session outright,
  // recorded on the consent artefact rather than left as a resumable kiosk state.
  CONSENT_GRANTED: ['IDENTITY_PENDING', 'EXITED', 'EXPIRED', 'ERROR'],
  // Self-loop, for the same reason QR_ISSUED has one: a patient may make more than one
  // identity attempt. The existing-patient screen offers three methods precisely so they
  // can try another, and someone who tries their mobile number, is refused, and then
  // reaches for their hospital card must not find the session wedged. Attempts are
  // individually recorded and rate-limited in `identity_attempt`; the self-loop weakens
  // nothing, it just stops a normal sequence looking like an illegal one.
  IDENTITY_PENDING: ['IDENTITY_PENDING', 'IDENTITY_CONFIRMED', 'EXITED', 'EXPIRED', 'ERROR'],
  IDENTITY_CONFIRMED: ['INTAKE_IN_PROGRESS', 'EXITED', 'EXPIRED', 'ERROR'],
  INTAKE_IN_PROGRESS: ['REVIEW_PENDING', 'EXITED', 'EXPIRED', 'ERROR'],
  // Editing sends the patient back into intake; submitting is only possible from review.
  REVIEW_PENDING: ['INTAKE_IN_PROGRESS', 'SUBMITTED', 'EXITED', 'EXPIRED', 'ERROR'],
  SUBMITTED: ['TOKEN_PENDING', 'EXITED', 'EXPIRED', 'ERROR'],
  TOKEN_PENDING: ['TOKEN_ISSUED', 'EXITED', 'EXPIRED', 'ERROR'],
  // The session ends after the token is shown; the record itself lives on server-side.
  TOKEN_ISSUED: ['EXITED', 'EXPIRED'],
  EXITED: [],
  EXPIRED: [],
  ERROR: ['EXITED', 'EXPIRED'],
};

export const kioskSessionMachine = new StateMachine<KioskSessionState>(
  'KioskSession',
  'CREATED',
  transitions,
);
