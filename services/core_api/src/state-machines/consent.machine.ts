import type { ConsentState } from '@medikiosk/api-contracts';
import { StateMachine, type TransitionTable } from './state-machine';

/**
 * Consent lifecycle.
 *
 * DECLINED is terminal: a patient who declines is not re-asked within the same artefact,
 * and clinical intake stops. Withdrawing later produces REVOKED, also terminal. Neither
 * can return to GRANTED — regaining consent means capturing a new artefact against the
 * notice version the patient was actually shown at that moment.
 */
const transitions: TransitionTable<ConsentState> = {
  PENDING: ['GRANTED', 'DECLINED'],
  GRANTED: ['EXPIRED', 'REVOKED'],
  DECLINED: [],
  EXPIRED: [],
  REVOKED: [],
};

export const consentMachine = new StateMachine<ConsentState>('Consent', 'PENDING', transitions);

/** Clinical intake may proceed only while consent is actively granted. */
export function permitsClinicalIntake(state: ConsentState): boolean {
  return state === 'GRANTED';
}
