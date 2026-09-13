-- 0021 — rate limiting, and what happens to data when the visit is long over.

-- Up Migration

-- Fixed-window counters, in the database rather than in memory.
--
-- A per-process counter is not a rate limit on a deployment with two instances behind a
-- load balancer: an attacker gets N attempts per instance and the limit quietly doubles.
-- At kiosk volumes the write cost is irrelevant and the shared count is exact.
CREATE TABLE rate_limit_bucket (
  -- What is being limited and for whom: 'otp:9876543210', 'staff-signin:1.2.3.4'.
  -- The subject is hashed by the caller where it is personal, so a leaked backup of this
  -- table is not a list of who tried to check in.
  bucket_key text NOT NULL,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),

  PRIMARY KEY (bucket_key, window_started_at)
);

CREATE INDEX rate_limit_bucket_window_idx ON rate_limit_bucket (window_started_at);

-- How long each kind of clinical data is kept, as a decision the hospital records rather
-- than a number in code.
CREATE TABLE retention_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES hospital (id),
  -- 'DOCUMENT', 'KIOSK_SESSION', 'IDENTITY_ATTEMPT', 'CLINICAL_SUMMARY'.
  data_kind text NOT NULL,
  retain_days integer NOT NULL CHECK (retain_days > 0),
  -- Who at the hospital signed this off. A retention period nobody approved is a number
  -- an engineer chose, and deleting a patient's records on that basis is not defensible.
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT retention_policy_one_per_kind UNIQUE (hospital_id, data_kind)
);

-- A hold that stops deletion, whatever the retention policy says.
--
-- Litigation, a complaint, a coroner's request. The rule is absolute and one-directional:
-- a hold always wins over a retention period, never the other way round, because deleting
-- evidence under a legal hold is a far worse failure than keeping data slightly too long.
CREATE TABLE legal_hold (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES hospital (id),
  patient_id uuid REFERENCES patient (id),
  encounter_id uuid REFERENCES encounter (id),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 10),
  placed_by text NOT NULL,
  placed_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  released_by text,

  -- A hold must name what it holds. One that names neither a patient nor an encounter
  -- holds nothing while looking like a control.
  CONSTRAINT legal_hold_names_a_subject CHECK (
    patient_id IS NOT NULL OR encounter_id IS NOT NULL
  ),
  CONSTRAINT legal_hold_release_is_attributed CHECK (
    (released_at IS NULL AND released_by IS NULL)
    OR (released_at IS NOT NULL AND released_by IS NOT NULL)
  )
);

CREATE INDEX legal_hold_active_patient_idx ON legal_hold (patient_id)
  WHERE released_at IS NULL;
CREATE INDEX legal_hold_active_encounter_idx ON legal_hold (encounter_id)
  WHERE released_at IS NULL;

-- Down Migration

DROP INDEX IF EXISTS legal_hold_active_encounter_idx;
DROP INDEX IF EXISTS legal_hold_active_patient_idx;
DROP TABLE IF EXISTS legal_hold;
DROP TABLE IF EXISTS retention_policy;
DROP INDEX IF EXISTS rate_limit_bucket_window_idx;
DROP TABLE IF EXISTS rate_limit_bucket;
