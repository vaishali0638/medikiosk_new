import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../db/db.module';
import type { DbExecutor } from '../db/transaction';
import type { Db } from '../db/db.provider';
import { redact } from '../common/redact';

export interface AuditEventInput {
  readonly actorId: string;
  readonly actorRole: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId?: string | undefined;
  readonly correlationId: string;
  /** Required for break-glass access. */
  readonly reason?: string | undefined;
  readonly detail?: Record<string, unknown> | undefined;
}

@Injectable()
export class AuditRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Appends an audit event.
   *
   * `executor` should be the surrounding transaction whenever the event records a state
   * change: the event and the change then commit or roll back together, so the log can
   * never claim something happened that did not, nor miss something that did.
   *
   * The detail payload is redacted here rather than at the call site — a caller who
   * forgets is the normal case, and one un-redacted audit row is a privacy incident.
   */
  async append(input: AuditEventInput, executor: DbExecutor = this.db): Promise<void> {
    await executor
      .insertInto('audit_event')
      .values({
        actor_id: input.actorId,
        actor_role: input.actorRole,
        action: input.action,
        entity_type: input.entityType,
        entity_id: input.entityId ?? null,
        correlation_id: input.correlationId,
        reason: input.reason ?? null,
        detail: JSON.stringify(redact(input.detail ?? {})),
      })
      .execute();
  }
}
