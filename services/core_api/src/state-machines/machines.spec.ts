import {
  CONSENT_STATES,
  KIOSK_SESSION_STATES,
  PRE_CHECKIN_STATES,
  TOKEN_REQUEST_STATES,
} from '@medikiosk/api-contracts';
import { InvalidStateTransitionError, type StateMachine } from './state-machine';
import { consentMachine, permitsClinicalIntake } from './consent.machine';
import { kioskSessionMachine } from './kiosk-session.machine';
import { preCheckinMachine } from './pre-checkin.machine';
import { tokenRequestMachine } from './token-request.machine';

/**
 * Proves that every path from `start` to `target` passes through `through`, by deleting
 * `through` from the graph and showing `target` becomes unreachable. This is how the
 * gating properties below are checked — asserting a few happy paths would not rule out
 * some other edge quietly bypassing the gate.
 */
function everyPathPassesThrough<S extends string>(
  machine: StateMachine<S>,
  start: S,
  target: S,
  through: S,
): boolean {
  const seen = new Set<S>([start]);
  const queue: S[] = [start];
  while (queue.length > 0) {
    const current = queue.shift() as S;
    if (current === target) return false; // reached the target without the gate
    for (const next of machine.next(current)) {
      if (next === through || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return true;
}

/** Asserts the machine rejects every ordered pair its table does not declare. */
function rejectsAllUndeclaredTransitions<S extends string>(
  machine: StateMachine<S>,
  allStates: readonly S[],
): void {
  for (const from of allStates) {
    for (const to of allStates) {
      if (machine.canTransition(from, to)) continue;
      expect(() => machine.assertTransition(from, to)).toThrow(InvalidStateTransitionError);
    }
  }
}

/**
 * Runs the table-level invariants for one machine. Written as a generic function rather
 * than a loop over a heterogeneous array so each machine's own state union is inferred.
 */
function describeMachineInvariants<S extends string>(
  machine: StateMachine<S>,
  states: readonly S[],
): void {
  describe(machine.name, () => {
    it('declares every state from the shared enum, and no others', () => {
      expect([...machine.states()].sort()).toEqual([...states].sort());
    });

    it('rejects every transition it does not declare', () => {
      rejectsAllUndeclaredTransitions(machine, states);
    });

    it('has no orphan state — all are reachable from the initial state', () => {
      const reachable = machine.reachableStates();
      for (const state of states) {
        expect(reachable.has(state)).toBe(true);
      }
    });

    it('has at least one terminal state, so a record can actually finish', () => {
      expect(states.some((state) => machine.isTerminal(state))).toBe(true);
    });
  });
}

describe('state machine tables', () => {
  describeMachineInvariants(kioskSessionMachine, KIOSK_SESSION_STATES);
  describeMachineInvariants(preCheckinMachine, PRE_CHECKIN_STATES);
  describeMachineInvariants(tokenRequestMachine, TOKEN_REQUEST_STATES);
  describeMachineInvariants(consentMachine, CONSENT_STATES);
});

describe('KioskSession safety properties', () => {
  it('cannot reach clinical intake without granted consent', () => {
    expect(
      everyPathPassesThrough(
        kioskSessionMachine,
        'CREATED',
        'INTAKE_IN_PROGRESS',
        'CONSENT_GRANTED',
      ),
    ).toBe(true);
  });

  it('cannot reach clinical intake without a confirmed identity', () => {
    expect(
      everyPathPassesThrough(
        kioskSessionMachine,
        'CREATED',
        'INTAKE_IN_PROGRESS',
        'IDENTITY_CONFIRMED',
      ),
    ).toBe(true);
  });

  it('cannot submit without the patient reviewing first', () => {
    expect(
      everyPathPassesThrough(kioskSessionMachine, 'CREATED', 'SUBMITTED', 'REVIEW_PENDING'),
    ).toBe(true);
  });

  it('cannot issue a token without submitting', () => {
    expect(
      everyPathPassesThrough(kioskSessionMachine, 'CREATED', 'TOKEN_ISSUED', 'SUBMITTED'),
    ).toBe(true);
  });

  it('lets the patient go back and edit from the review screen', () => {
    expect(kioskSessionMachine.canTransition('REVIEW_PENDING', 'INTAKE_IN_PROGRESS')).toBe(true);

    // A patient may try their mobile number, be refused, and then reach for their
    // hospital card. That is a normal sequence, not an illegal transition, and a session
    // that wedged on the second attempt would end a working check-in.
    expect(kioskSessionMachine.canTransition('IDENTITY_PENDING', 'IDENTITY_PENDING')).toBe(true);

    // The self-loop must not become a way around confirmation.
    expect(
      everyPathPassesThrough(
        kioskSessionMachine,
        'CREATED',
        'IDENTITY_CONFIRMED',
        'CONSENT_GRANTED',
      ),
    ).toBe(true);
  });

  it('allows Exit and timeout from every non-terminal state', () => {
    for (const state of KIOSK_SESSION_STATES) {
      if (kioskSessionMachine.isTerminal(state)) continue;
      expect(kioskSessionMachine.canTransition(state, 'EXITED')).toBe(true);
      expect(kioskSessionMachine.canTransition(state, 'EXPIRED')).toBe(true);
    }
  });

  it('treats EXITED and EXPIRED as final — a wiped session is never resumed', () => {
    expect(kioskSessionMachine.isTerminal('EXITED')).toBe(true);
    expect(kioskSessionMachine.isTerminal('EXPIRED')).toBe(true);
  });
});

describe('PreCheckin safety properties', () => {
  it('cannot issue a token without a physical arrival at the kiosk', () => {
    expect(
      everyPathPassesThrough(preCheckinMachine, 'DRAFT', 'TOKEN_ISSUED', 'ARRIVAL_CONFIRMED'),
    ).toBe(true);
  });

  it('cannot issue a QR before the intake is submitted', () => {
    expect(everyPathPassesThrough(preCheckinMachine, 'DRAFT', 'QR_ISSUED', 'SUBMITTED')).toBe(true);
  });

  it('does not let a phone jump straight from QR to a token', () => {
    expect(preCheckinMachine.canTransition('QR_ISSUED', 'TOKEN_ISSUED')).toBe(false);
    expect(preCheckinMachine.canTransition('QR_ISSUED', 'TOKEN_REQUESTED')).toBe(false);
  });

  it('lets an expired QR be reissued without redoing the intake', () => {
    expect(preCheckinMachine.canTransition('QR_EXPIRED', 'QR_ISSUED')).toBe(true);
  });

  it('resolves a reconciliation only to an issued token or a cancellation', () => {
    expect([...preCheckinMachine.next('RECONCILIATION_REQUIRED')].sort()).toEqual([
      'CANCELLED',
      'TOKEN_ISSUED',
    ]);
  });

  it('never returns a consumed pre-check-in to any active state', () => {
    expect(preCheckinMachine.isTerminal('CONSUMED')).toBe(true);
    expect(preCheckinMachine.isTerminal('CANCELLED')).toBe(true);
  });
});

describe('TokenRequest safety properties', () => {
  it('treats an issued token as final — no path can produce a second one', () => {
    expect(tokenRequestMachine.isTerminal('ISSUED')).toBe(true);
    for (const state of TOKEN_REQUEST_STATES) {
      if (state === 'ISSUED') continue;
      expect(tokenRequestMachine.canTransition('ISSUED', state)).toBe(false);
    }
  });

  it('allows a retry only after a definitive failure', () => {
    expect(tokenRequestMachine.canTransition('FAILED', 'REQUESTED')).toBe(true);
  });

  it('does not auto-resolve an uncertain outcome', () => {
    expect(tokenRequestMachine.isTerminal('UNKNOWN_RECONCILIATION_REQUIRED')).toBe(true);
    expect(tokenRequestMachine.canTransition('UNKNOWN_RECONCILIATION_REQUIRED', 'REQUESTED')).toBe(
      false,
    );
    expect(tokenRequestMachine.canTransition('UNKNOWN_RECONCILIATION_REQUIRED', 'ISSUED')).toBe(
      false,
    );
  });

  it('cannot issue a token without first requesting one', () => {
    expect(tokenRequestMachine.canTransition('NOT_STARTED', 'ISSUED')).toBe(false);
    expect(everyPathPassesThrough(tokenRequestMachine, 'NOT_STARTED', 'ISSUED', 'REQUESTED')).toBe(
      true,
    );
  });
});

describe('Consent safety properties', () => {
  it('permits clinical intake only while granted', () => {
    for (const state of CONSENT_STATES) {
      expect(permitsClinicalIntake(state)).toBe(state === 'GRANTED');
    }
  });

  it('never returns a declined or revoked consent to granted', () => {
    expect(consentMachine.isTerminal('DECLINED')).toBe(true);
    expect(consentMachine.isTerminal('REVOKED')).toBe(true);
    expect(consentMachine.canTransition('DECLINED', 'GRANTED')).toBe(false);
    expect(consentMachine.canTransition('REVOKED', 'GRANTED')).toBe(false);
    expect(consentMachine.canTransition('EXPIRED', 'GRANTED')).toBe(false);
  });

  it('supports withdrawal of a granted consent', () => {
    expect(consentMachine.canTransition('GRANTED', 'REVOKED')).toBe(true);
  });
});
