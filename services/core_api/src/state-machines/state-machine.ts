import type { ErrorCode } from '@medikiosk/api-contracts';

/**
 * Thrown when code attempts a transition the machine does not allow.
 *
 * This is a hard failure, never a warning that is logged and stepped over. A kiosk
 * session that reaches TOKEN_ISSUED without passing through CONSENT_GRANTED and
 * IDENTITY_CONFIRMED represents either a bug or an attack, and in both cases the
 * correct response is to refuse and audit.
 */
export class InvalidStateTransitionError extends Error {
  readonly code: ErrorCode = 'INVALID_STATE_TRANSITION';

  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`${machine}: ${from} -> ${to} is not a permitted transition`);
    this.name = 'InvalidStateTransitionError';
  }
}

/**
 * An explicit transition table.
 *
 * The table is typed as a total record over the state union, so adding a state to the
 * enum fails compilation until its outgoing edges are declared. There is no implicit
 * "any state can reach ERROR" escape hatch — every edge, including error edges, is
 * written down and therefore reviewable.
 */
export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

export class StateMachine<S extends string> {
  constructor(
    readonly name: string,
    readonly initial: S,
    private readonly transitions: TransitionTable<S>,
  ) {}

  /** Every state the machine knows about. */
  states(): readonly S[] {
    return Object.keys(this.transitions) as S[];
  }

  /** States reachable in one step from `from`. */
  next(from: S): readonly S[] {
    return this.transitions[from];
  }

  /** A state with no outgoing edges. The record ends here. */
  isTerminal(state: S): boolean {
    return this.transitions[state].length === 0;
  }

  canTransition(from: S, to: S): boolean {
    return this.transitions[from].includes(to);
  }

  /** Throws unless the transition is permitted. Call this inside the same transaction
   *  that writes the new state, so a rejected transition cannot be partially applied. */
  assertTransition(from: S, to: S): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidStateTransitionError(this.name, from, to);
    }
  }

  /** Every state reachable from the initial state. Used to prove no state is orphaned. */
  reachableStates(): ReadonlySet<S> {
    const seen = new Set<S>([this.initial]);
    const queue: S[] = [this.initial];
    while (queue.length > 0) {
      const current = queue.shift() as S;
      for (const target of this.transitions[current]) {
        if (!seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }
    return seen;
  }
}
