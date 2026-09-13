import { Inject, Injectable, Logger } from '@nestjs/common';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.provider';
import type { GovernanceState } from '@medikiosk/api-contracts';
import type { GovernanceVersionRow } from '../db/database.types';
import { withSerializableRetry } from '../db/transaction';
import { DomainError } from '../common/domain-error';
import { AuditRepository } from '../audit/audit.repository';
import { governanceMachine } from '../state-machines';
import { approvalSchema, checkPublishable, type Approval } from './approval';
import { validateContent } from './content-validation';
import type { StaffContext } from '../staff/staff-auth.service';

export interface DraftInput {
  readonly hospitalId: string;
  readonly contentKind: string;
  readonly contentKey: string;
  readonly semver: string;
  readonly payload: unknown;
  /** Overrides the derived pointer. Rarely needed; the live version is the right answer. */
  readonly rollbackToId?: string | undefined;
  readonly correlationId: string;
  readonly actor: StaffContext;
}

@Injectable()
export class ReleaseService {
  private readonly logger = new Logger(ReleaseService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Creates a draft, having checked it parses and does not collide.
   *
   * Validation happens at authoring rather than at publication. A questionnaire that fails
   * its schema should be rejected while the author is still looking at it, not three
   * reviews later when four people's time has been spent on something that was never
   * loadable.
   */
  async createDraft(input: DraftInput): Promise<GovernanceVersionRow> {
    const problems = validateContent(input.contentKind, input.payload);
    if (problems.length > 0) {
      throw new DomainError(
        'VALIDATION_FAILED',
        input.correlationId,
        `content is not valid: ${problems.join('; ')}`,
      );
    }

    const clash = await this.db
      .selectFrom('governance_version')
      .select('id')
      .where('hospital_id', '=', input.hospitalId)
      .where('content_kind', '=', input.contentKind)
      .where('content_key', '=', input.contentKey)
      .where('semver', '=', input.semver)
      .executeTakeFirst();

    if (clash) {
      // A version number is what a clinical record cites. Reusing one would make an old
      // record cite content it never saw.
      throw new DomainError(
        'VALIDATION_FAILED',
        input.correlationId,
        `${input.contentKey} ${input.semver} already exists`,
      );
    }

    // The version this one supersedes is, by definition, whatever is live for the key.
    // `checkPublishable` requires the pointer on every non-first release, and there was no
    // way to supply one through the console — the requirement existed with no means of
    // satisfying it, which is how a governance rule becomes something people route around.
    // Deriving it also removes a manual step that gets typed wrong under pressure, which
    // is exactly when a rollback pointer is used.
    const superseded =
      input.rollbackToId ??
      (
        await this.db
          .selectFrom('governance_version')
          .select('id')
          .where('hospital_id', '=', input.hospitalId)
          .where('content_kind', '=', input.contentKind)
          .where('content_key', '=', input.contentKey)
          .where('state', '=', 'PUBLISHED')
          .executeTakeFirst()
      )?.id ??
      null;

    const row = await this.db
      .insertInto('governance_version')
      .values({
        hospital_id: input.hospitalId,
        content_kind: input.contentKind,
        content_key: input.contentKey,
        semver: input.semver,
        state: 'DRAFT',
        payload: JSON.stringify(input.payload),
        author_actor_id: input.actor.userId,
        approvals: JSON.stringify([]),
        rollback_to_id: superseded,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.recordTransition(row.id, null, 'DRAFT', input.actor, input.correlationId, null);
    return row;
  }

  /** Adds one named approval. Approvals accumulate; they are never replaced wholesale. */
  async approve(input: {
    versionId: string;
    approval: unknown;
    actor: StaffContext;
    correlationId: string;
  }): Promise<GovernanceVersionRow> {
    const parsed = approvalSchema.safeParse(input.approval);
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', input.correlationId, 'bad approval');
    }

    return withSerializableRetry(this.db, async (trx) => {
      const row = await trx
        .selectFrom('governance_version')
        .selectAll()
        .where('id', '=', input.versionId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      if (row.state !== 'IN_REVIEW') {
        throw new DomainError(
          'VALIDATION_FAILED',
          input.correlationId,
          `cannot approve content in ${row.state}`,
        );
      }

      const existing = (row.approvals ?? []) as Approval[];
      // One person, one role. Re-approving in the same role replaces their own entry
      // rather than counting twice towards the distinct-approver requirement.
      const others = existing.filter(
        (a) => !(a.role === parsed.data.role && a.by === parsed.data.by),
      );

      const updated = await trx
        .updateTable('governance_version')
        .set({ approvals: JSON.stringify([...others, parsed.data]) })
        .where('id', '=', input.versionId)
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.audit.append(
        {
          actorId: input.actor.userId,
          actorRole: input.actor.role,
          action: 'GOVERNANCE_APPROVAL_RECORDED',
          entityType: 'governance_version',
          entityId: input.versionId,
          correlationId: input.correlationId,
          detail: { role: parsed.data.role, by: parsed.data.by },
        },
        trx,
      );

      return updated;
    });
  }

  /**
   * Moves a release along, refusing anything the machine or the approvals do not permit.
   *
   * The approval gate is checked on exactly one edge — IN_REVIEW to APPROVED. Everything
   * downstream is unreachable without passing through it, so publication does not need to
   * re-check and cannot be reached by a path that skipped it.
   */
  async transition(input: {
    versionId: string;
    to: GovernanceState;
    actor: StaffContext;
    correlationId: string;
    note?: string | undefined;
    /** When the content takes effect. Defaults to now on the APPROVED edge. */
    effectiveFrom?: Date | undefined;
    canaryKioskCodes?: readonly string[] | undefined;
    rollbackReason?: string | undefined;
  }): Promise<GovernanceVersionRow> {
    if (input.actor.role !== 'GOVERNANCE_REVIEWER') {
      throw new DomainError(
        'NOT_AUTHORISED',
        input.correlationId,
        `role ${input.actor.role} may not move a release`,
      );
    }

    return withSerializableRetry(this.db, async (trx) => {
      const row = await trx
        .selectFrom('governance_version')
        .selectAll()
        .where('id', '=', input.versionId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      governanceMachine.assertTransition(row.state, input.to);

      const patch: Record<string, unknown> = { state: input.to };

      if (row.state === 'IN_REVIEW' && input.to === 'APPROVED') {
        // When the content takes effect is part of what reviewers sign off, so it is set
        // on THIS edge rather than at publication. Defaulting to now is an explicit
        // decision — "approved today, effective today" — and is the common case; a future
        // date is supplied when a hospital is coordinating a changeover.
        const effectiveFrom = input.effectiveFrom ?? row.effective_from ?? new Date();
        await trx
          .updateTable('governance_version')
          .set({ effective_from: effectiveFrom })
          .where('id', '=', input.versionId)
          .execute();

        await this.requireApprovals(
          trx,
          { ...row, effective_from: effectiveFrom },
          input.correlationId,
        );
        patch['effective_from'] = effectiveFrom;
      }

      if (input.to === 'CANARY') {
        const codes = input.canaryKioskCodes ?? [];
        if (codes.length === 0) {
          throw new DomainError(
            'VALIDATION_FAILED',
            input.correlationId,
            'a canary must name the kiosks it reaches',
          );
        }
        patch['canary_kiosk_codes'] = codes;
        patch['published_by_user_id'] = input.actor.userId;
        patch['published_at'] = new Date();
      }

      if (input.to === 'PUBLISHED') {
        // Supersede whatever is live for this key, in the same transaction. Two published
        // versions of one questionnaire is a state the unique index refuses anyway; doing
        // it here means the changeover is atomic rather than a window with neither.
        await trx
          .updateTable('governance_version')
          .set({
            state: 'RETIRED',
          })
          .where('hospital_id', '=', row.hospital_id)
          .where('content_kind', '=', row.content_kind)
          .where('content_key', '=', row.content_key)
          .where('state', '=', 'PUBLISHED')
          .where('id', '!=', row.id)
          .execute();

        patch['published_by_user_id'] = input.actor.userId;
        patch['published_at'] = new Date();
        patch['canary_kiosk_codes'] = [];
      }

      if (input.to === 'ROLLED_BACK') {
        if (!input.rollbackReason || input.rollbackReason.trim().length < 10) {
          throw new DomainError(
            'VALIDATION_FAILED',
            input.correlationId,
            'a rollback must state a reason',
          );
        }
        patch['rolled_back_at'] = new Date();
        patch['rolled_back_by_user_id'] = input.actor.userId;
        patch['rollback_reason'] = input.rollbackReason.trim();
      }

      const updated = await trx
        .updateTable('governance_version')
        .set(patch as never)
        .where('id', '=', input.versionId)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Restoring the superseded version happens AFTER this one leaves PUBLISHED, not
      // before: `governance_version_one_published` allows exactly one live version per
      // key, and doing it in the other order makes the two briefly coexist and the whole
      // rollback fail. Both are in one transaction, so there is no moment with neither.
      //
      // A rollback that leaves nothing live is an outage — the kiosk finds no published
      // questionnaire and stops — so this is the half of rollback that matters.
      if (input.to === 'ROLLED_BACK' && row.rollback_to_id) {
        await trx
          .updateTable('governance_version')
          .set({
            state: 'PUBLISHED',
            published_at: new Date(),
            published_by_user_id: input.actor.userId,
          })
          .where('id', '=', row.rollback_to_id)
          .execute();
      }

      await trx
        .insertInto('governance_transition')
        .values({
          governance_version_id: input.versionId,
          from_state: row.state,
          to_state: input.to,
          actor_user_id: input.actor.userId,
          note: input.note ?? input.rollbackReason ?? null,
          correlation_id: input.correlationId,
        })
        .execute();

      await this.audit.append(
        {
          actorId: input.actor.userId,
          actorRole: input.actor.role,
          action: 'GOVERNANCE_RELEASE_TRANSITIONED',
          entityType: 'governance_version',
          entityId: input.versionId,
          correlationId: input.correlationId,
          reason: input.rollbackReason,
          detail: {
            contentKind: row.content_kind,
            contentKey: row.content_key,
            semver: row.semver,
            from: row.state,
            to: input.to,
          },
        },
        trx,
      );

      if (input.to === 'ROLLED_BACK') {
        this.logger.warn(
          `ROLLBACK ${row.content_kind}/${row.content_key} ${row.semver} by ` +
            `${input.actor.userId} correlationId=${input.correlationId}`,
        );
      }

      return updated;
    });
  }

  /** Refuses the APPROVED edge unless the content kind's named approvals are all present. */
  private async requireApprovals(
    trx: Db,
    row: GovernanceVersionRow,
    correlationId: string,
  ): Promise<void> {
    const previous = await trx
      .selectFrom('governance_version')
      .select('id')
      .where('hospital_id', '=', row.hospital_id)
      .where('content_kind', '=', row.content_kind)
      .where('content_key', '=', row.content_key)
      .where('id', '!=', row.id)
      .where('state', 'in', ['PUBLISHED', 'RETIRED', 'ROLLED_BACK'])
      .executeTakeFirst();

    const problems = checkPublishable({
      contentKind: row.content_kind,
      contentKey: row.content_key,
      version: row.semver,
      approvals: (row.approvals ?? []) as Approval[],
      effectiveFrom: row.effective_from,
      rollbackToId: row.rollback_to_id,
      isFirstRelease: previous === undefined,
    });

    if (problems.length > 0) {
      // Every problem at once. An author fixing one thing per review cycle is how a
      // governance process gets abandoned.
      throw new DomainError(
        'VALIDATION_FAILED',
        correlationId,
        `not approvable: ${problems.join('; ')}`,
      );
    }
  }

  private async recordTransition(
    versionId: string,
    from: GovernanceState | null,
    to: GovernanceState,
    actor: StaffContext,
    correlationId: string,
    note: string | null,
  ): Promise<void> {
    await this.db
      .insertInto('governance_transition')
      .values({
        governance_version_id: versionId,
        from_state: from,
        to_state: to,
        actor_user_id: actor.userId,
        note,
        correlation_id: correlationId,
      })
      .execute();
  }

  /** The full history of a release, for a governance committee to read. */
  async history(versionId: string): Promise<unknown[]> {
    return this.db
      .selectFrom('governance_transition')
      .selectAll()
      .where('governance_version_id', '=', versionId)
      .orderBy('occurred_at', 'asc')
      .execute();
  }
}
