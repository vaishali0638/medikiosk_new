-- 0006 — append-only audit trail and the integration outbox.

-- Up Migration

CREATE TABLE audit_event (
  id                  bigserial PRIMARY KEY,
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  -- Who acted: a staff subject id, a kiosk device code, or 'SYSTEM'. Never a patient's
  -- name or contact details — those belong in the referenced record, not the log.
  actor_id            text NOT NULL,
  actor_role          text NOT NULL,
  action              text NOT NULL,
  -- What was acted on, by table name and primary key.
  entity_type         text NOT NULL,
  entity_id           text,
  -- Ties this event to the rest of one patient journey across every service.
  correlation_id      uuid NOT NULL,
  -- Required for break-glass access, so an emergency override always states its reason.
  reason              text,
  -- Redacted structured detail. Writers must pass payloads through redact() first.
  detail              jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT audit_break_glass_needs_reason CHECK (
    action <> 'BREAK_GLASS_ACCESS' OR reason IS NOT NULL
  )
);

CREATE INDEX audit_event_correlation_idx ON audit_event (correlation_id);
CREATE INDEX audit_event_entity_idx ON audit_event (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_event_actor_idx ON audit_event (actor_id, occurred_at DESC);
CREATE INDEX audit_event_occurred_idx ON audit_event (occurred_at DESC);

-- Append-only, enforced in the database. An audit trail that the application can edit
-- is not an audit trail; a compromised service account must not be able to erase its
-- own tracks. Corrections are appended as new events, never applied in place.
CREATE RULE audit_event_no_update AS ON UPDATE TO audit_event DO INSTEAD NOTHING;
CREATE RULE audit_event_no_delete AS ON DELETE TO audit_event DO INSTEAD NOTHING;

-- Outbound integration messages (HIS token requests, EMR exports, ABDM later).
-- Written in the same transaction as the state change that causes them, so a message
-- can never be lost by a crash between "state saved" and "message sent".
CREATE TABLE integration_outbox (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The target system, e.g. 'HIS_TOKEN', 'EMR_EXPORT'.
  channel             text NOT NULL,
  -- Deduplicates on the receiving side and across retries.
  idempotency_key     text NOT NULL,
  payload             jsonb NOT NULL,
  state               outbox_state NOT NULL DEFAULT 'PENDING',
  attempt_count       integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  last_error_code     text,
  delivered_at        timestamptz,
  correlation_id      uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (channel, idempotency_key),
  CONSTRAINT outbox_delivered_has_timestamp CHECK (
    (state = 'DELIVERED') = (delivered_at IS NOT NULL)
  )
);

-- Drives the dispatcher: the next batch of messages actually due for an attempt.
CREATE INDEX integration_outbox_due_idx ON integration_outbox (next_attempt_at)
  WHERE state IN ('PENDING', 'FAILED');
CREATE INDEX integration_outbox_dead_letter_idx ON integration_outbox (created_at)
  WHERE state = 'DEAD_LETTER';

CREATE TRIGGER integration_outbox_updated_at BEFORE UPDATE ON integration_outbox
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER integration_outbox_version BEFORE UPDATE ON integration_outbox
  FOR EACH ROW EXECUTE FUNCTION bump_row_version();

-- Down Migration

DROP TABLE IF EXISTS integration_outbox;
DROP RULE IF EXISTS audit_event_no_delete ON audit_event;
DROP RULE IF EXISTS audit_event_no_update ON audit_event;
DROP TABLE IF EXISTS audit_event;
