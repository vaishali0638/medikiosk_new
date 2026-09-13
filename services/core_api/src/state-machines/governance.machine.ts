import type { GovernanceState } from '@medikiosk/api-contracts';
import { StateMachine, type TransitionTable } from './state-machine';

/**
 * The release lifecycle for governed clinical content.
 *
 * The safety-critical shape is that PUBLISHED is reachable only through APPROVED, and
 * APPROVED only through IN_REVIEW. There is no edge from DRAFT to PUBLISHED, so no amount
 * of client cleverness can put unreviewed clinical content in front of a patient — the
 * approvals are checked on the IN_REVIEW -> APPROVED edge, and everything downstream
 * inherits that check by being unreachable without it.
 *
 * CANARY sits between APPROVED and PUBLISHED rather than beside it. A canary is a real
 * release to a subset of kiosks, so it must clear the same approvals as a full one; the
 * difference is blast radius, not scrutiny.
 *
 * ROLLED_BACK is terminal for that version. Rolling back does not restore a version to
 * draft to be edited and re-released under the same number — the number is what a clinical
 * record cites when it says which questionnaire a patient answered, and it must keep
 * meaning one thing forever.
 */
const transitions: TransitionTable<GovernanceState> = {
  DRAFT: ['IN_REVIEW', 'RETIRED'],
  // Back to draft when a reviewer sends it back. That is the normal case, not a failure.
  IN_REVIEW: ['DRAFT', 'APPROVED', 'RETIRED'],
  // Approved content may go straight to publication, or through a canary first.
  APPROVED: ['CANARY', 'PUBLISHED', 'RETIRED'],
  // A canary that behaves goes live; one that does not is rolled back.
  CANARY: ['PUBLISHED', 'ROLLED_BACK'],
  // Superseded by a later version, or withdrawn because something is wrong with it.
  PUBLISHED: ['ROLLED_BACK', 'RETIRED'],
  ROLLED_BACK: [],
  RETIRED: [],
};

export const governanceMachine = new StateMachine<GovernanceState>(
  'GovernanceVersion',
  'DRAFT',
  transitions,
);
