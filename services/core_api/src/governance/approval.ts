import { z } from 'zod';

/**
 * The four roles the specification requires on an AYUSH module.
 *
 * They are separate roles because they check different things, and one person holding
 * all four is not four checks. An Ayurveda practitioner can say whether a Prakriti
 * question is sound; only a translation reviewer can say whether its Hindi says the same
 * thing; only a safety reviewer is looking for the ways it could go wrong.
 */
export const APPROVAL_ROLES = [
  'AUTHOR',
  'CLINICAL_REVIEWER',
  'TRANSLATION_REVIEWER',
  'SAFETY_REVIEWER',
] as const;

export type ApprovalRole = (typeof APPROVAL_ROLES)[number];

export const approvalSchema = z.object({
  role: z.enum(APPROVAL_ROLES),
  /** The person. A name, or a directory identifier — never a service account. */
  by: z.string().min(1).max(200),
  /**
   * Registration or qualification, for the roles where it is the whole point. "Reviewed
   * by a practitioner" means nothing without saying a practitioner of what.
   */
  qualification: z.string().max(200).optional(),
  at: z.string().datetime({ offset: true }),
});

export type Approval = z.infer<typeof approvalSchema>;

export interface ApprovalRequirement {
  readonly roles: readonly ApprovalRole[];
  /** Minimum number of DISTINCT people. Guards against one person filling every role. */
  readonly distinctApprovers: number;
  /** Roles that must state a qualification. */
  readonly qualificationRequired: readonly ApprovalRole[];
  /** Whether a superseding release must point at what it replaces. */
  readonly rollbackPointerRequired: boolean;
}

/**
 * What each kind of governed content must carry before it may be published.
 *
 * An AYUSH module is the strictest: it is clinical protocol for a system of medicine, and
 * the specification is explicit that a model must not invent one. Four named roles, at
 * least two distinct people, and the author must state their qualification in that system.
 */
export const APPROVAL_REQUIREMENTS: Readonly<Record<string, ApprovalRequirement>> = {
  AYUSH_MODULE: {
    roles: ['AUTHOR', 'CLINICAL_REVIEWER', 'TRANSLATION_REVIEWER', 'SAFETY_REVIEWER'],
    distinctApprovers: 2,
    qualificationRequired: ['AUTHOR', 'CLINICAL_REVIEWER'],
    rollbackPointerRequired: true,
  },
  QUESTIONNAIRE: {
    roles: ['AUTHOR', 'CLINICAL_REVIEWER'],
    distinctApprovers: 2,
    qualificationRequired: ['CLINICAL_REVIEWER'],
    rollbackPointerRequired: true,
  },
  COMPLAINT_BRANCH: {
    roles: ['AUTHOR', 'CLINICAL_REVIEWER'],
    distinctApprovers: 2,
    qualificationRequired: ['CLINICAL_REVIEWER'],
    rollbackPointerRequired: true,
  },
  RED_FLAG_RULE: {
    // A rule that fires an internal alert is safety-critical by definition.
    roles: ['AUTHOR', 'CLINICAL_REVIEWER', 'SAFETY_REVIEWER'],
    distinctApprovers: 2,
    qualificationRequired: ['CLINICAL_REVIEWER'],
    rollbackPointerRequired: true,
  },
  CONSENT_NOTICE: {
    roles: ['AUTHOR', 'CLINICAL_REVIEWER', 'TRANSLATION_REVIEWER'],
    distinctApprovers: 2,
    qualificationRequired: [],
    rollbackPointerRequired: false,
  },
};

export interface PublishCandidate {
  readonly contentKind: string;
  readonly contentKey: string;
  readonly version: string;
  readonly approvals: readonly Approval[];
  readonly effectiveFrom: Date | null;
  readonly rollbackToId: string | null;
  /** True when nothing has ever been published for this key — no rollback target exists. */
  readonly isFirstRelease: boolean;
}

/**
 * Everything wrong with a release, or an empty list.
 *
 * Returns ALL problems rather than the first: an author fixing one thing at a time,
 * through a review cycle each round, is how governance processes get abandoned.
 */
export function checkPublishable(candidate: PublishCandidate): string[] {
  const requirement = APPROVAL_REQUIREMENTS[candidate.contentKind];
  // Unknown content kinds are not silently waved through.
  if (!requirement) {
    return candidate.approvals.length > 0
      ? []
      : [`${candidate.contentKind} must carry at least one named approval`];
  }

  const problems: string[] = [];
  const present = new Map(candidate.approvals.map((a) => [a.role, a]));

  for (const role of requirement.roles) {
    if (!present.has(role)) problems.push(`missing approval from a ${role}`);
  }

  for (const role of requirement.qualificationRequired) {
    const approval = present.get(role);
    if (approval && !approval.qualification?.trim()) {
      // "Reviewed by a practitioner" means nothing without saying a practitioner of what.
      problems.push(`${role} must state their qualification`);
    }
  }

  const distinct = new Set(candidate.approvals.map((a) => a.by.trim().toLowerCase()));
  if (distinct.size < requirement.distinctApprovers) {
    problems.push(
      `needs ${requirement.distinctApprovers} distinct approvers, found ${distinct.size}`,
    );
  }

  if (!candidate.effectiveFrom) problems.push('missing an effective date');

  if (requirement.rollbackPointerRequired && !candidate.isFirstRelease && !candidate.rollbackToId) {
    // Without it there is nothing to fall back to when a release turns out to be wrong,
    // and "roll back" becomes "find the previous version by hand, under pressure".
    problems.push('missing a rollback pointer to the version it supersedes');
  }

  // A pre-release version is content that says it is not finished. Publishing one as
  // live content contradicts its own version.
  if (candidate.version.includes('-')) {
    problems.push(
      `version ${candidate.version} is a pre-release and cannot be published as live content`,
    );
  }

  return problems;
}
