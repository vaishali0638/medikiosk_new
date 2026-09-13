-- 0019 — who a clinician is, what they may see, and what they did.
--
-- Everything before this phase was either a kiosk (a device certificate) or a patient (an
-- OTP). A clinician is the first actor who reads other people's records, so this is the
-- first place the system needs to answer "who are you, and are you allowed".

-- Up Migration

CREATE TYPE staff_role AS ENUM ('CLINICIAN', 'GOVERNANCE_REVIEWER', 'OPERATIONS');

CREATE TABLE staff_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES hospital (id),
  -- The subject claim from the hospital's identity provider. This is the join to SSO;
  -- MediKiosk never stores a staff password and has no way to authenticate one.
  subject text NOT NULL,
  display_name text NOT NULL,
  role staff_role NOT NULL,
  -- The department this clinician normally works in. NULL means hospital-wide, which is
  -- for governance and operations roles rather than for doctors: a clinician with no
  -- department can see every patient in the building, so it is deliberately not the
  -- default and is visible in the row.
  department_id uuid REFERENCES department (id),
  registration_number text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT staff_user_subject_unique UNIQUE (hospital_id, subject)
);

-- A signed-in clinician. Short-lived, revocable, and stored as a hash.
CREATE TABLE staff_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES staff_user (id) ON DELETE CASCADE,
  -- SHA-256 of the bearer token. The token itself is shown once, to the browser that
  -- signed in; a stolen database gives an attacker no usable session.
  token_hash text NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,

  CONSTRAINT staff_session_expires_after_issue CHECK (expires_at > issued_at)
);

CREATE INDEX staff_session_live_idx ON staff_session (staff_user_id, expires_at)
  WHERE revoked_at IS NULL;

-- Access to a record outside the clinician's own department, with the reason they gave.
--
-- A separate table rather than a flag on the audit event, because break-glass is the one
-- access that a human is expected to review afterwards, and it should be possible to list
-- every instance without filtering a table that holds millions of ordinary events.
CREATE TABLE break_glass_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES staff_user (id),
  encounter_id uuid NOT NULL REFERENCES encounter (id),
  -- Free text, required, and never defaulted. "Emergency" typed by a person is a weaker
  -- claim than the same word supplied by a client, and the difference matters at review.
  reason text NOT NULL CHECK (length(btrim(reason)) >= 10),
  accessed_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid NOT NULL
);

CREATE INDEX break_glass_recent_idx ON break_glass_access (accessed_at DESC);

-- The export of a confirmed record to the hospital's own systems.
--
-- Separate from token_request even though both talk to the HIS: a token is a queue
-- position and an export is a clinical record. Conflating them would mean one retry
-- policy for two things with very different consequences for getting it wrong.
CREATE TABLE encounter_export (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES encounter (id),
  -- Derived from the encounter, never supplied by a client, so every retry converges.
  idempotency_key text NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('PENDING', 'SENT', 'ACKNOWLEDGED', 'FAILED', 'RECONCILIATION_REQUIRED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  his_record_ref text,
  last_error_code text,
  exported_by_user_id text NOT NULL,
  payload_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Optimistic concurrency, like every other mutable row here. The unique idempotency key
  -- already stops two exports of one encounter, but this row's STATE is also read and
  -- written across an adapter call, and a stale write could report a rejection over an
  -- acknowledgement.
  version integer NOT NULL DEFAULT 1,
  correlation_id uuid NOT NULL
);

CREATE TRIGGER encounter_export_updated_at BEFORE UPDATE ON encounter_export
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER encounter_export_version BEFORE UPDATE ON encounter_export
  FOR EACH ROW EXECUTE FUNCTION bump_row_version();

-- One successful export per encounter. A record sent twice is a duplicate entry in the
-- hospital's EMR, which a clinician then has to notice and reconcile by hand.
CREATE UNIQUE INDEX encounter_export_one_acknowledged
  ON encounter_export (encounter_id)
  WHERE state IN ('SENT', 'ACKNOWLEDGED');

-- Down Migration

DROP INDEX IF EXISTS encounter_export_one_acknowledged;
DROP TABLE IF EXISTS encounter_export;
DROP INDEX IF EXISTS break_glass_recent_idx;
DROP TABLE IF EXISTS break_glass_access;
DROP INDEX IF EXISTS staff_session_live_idx;
DROP TABLE IF EXISTS staff_session;
DROP TABLE IF EXISTS staff_user;
DROP TYPE IF EXISTS staff_role;
