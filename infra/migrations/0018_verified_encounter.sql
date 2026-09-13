-- 0018 — the clinical visit, and what makes one clinician-verified.
--
-- Phase 2 created `encounter` and `follow_up_delta`, and `follow_up_delta` requires a
-- `previous_encounter_id`. Nothing had ever written an encounter row, so the follow-up
-- baseline had nowhere to point. This migration makes an encounter a real record of a
-- realised visit and gives it the one property the follow-up flow depends on.

-- Up Migration

-- Which pre-check-in produced this encounter. One encounter per visit.
--
-- Not a partial index: Postgres already treats NULLs as distinct in a unique index, so
-- any number of encounters may carry no pre-check-in while a given one appears at most
-- once. A partial index would say the same thing and could not be named by ON CONFLICT
-- without repeating its predicate.
ALTER TABLE encounter ADD COLUMN pre_checkin_id uuid REFERENCES pre_checkin (id);
CREATE UNIQUE INDEX encounter_one_per_pre_checkin ON encounter (pre_checkin_id);

-- When a clinician confirmed the record, and who. Both or neither: a verification with
-- no name attached is not a verification, and a name with no time cannot be ordered
-- against the next one.
ALTER TABLE encounter ADD COLUMN verified_at timestamptz;
ALTER TABLE encounter ADD COLUMN verified_by_user_id text;

-- The record they verified. It points at a `clinical_summary`, whose own constraint
-- (`clinical_summary_verified_label`, migration 0016) already refuses the
-- CLINICIAN-VERIFIED label unless a clinician and a timestamp are set. So a verified
-- encounter cannot point at an AI draft: the draft physically cannot carry the label, and
-- the constraint below requires that it does.
ALTER TABLE encounter ADD COLUMN verified_summary_id uuid REFERENCES clinical_summary (id);

ALTER TABLE encounter ADD CONSTRAINT encounter_verification_is_complete CHECK (
  (verified_at IS NULL AND verified_by_user_id IS NULL AND verified_summary_id IS NULL)
  OR
  (verified_at IS NOT NULL AND verified_by_user_id IS NOT NULL AND verified_summary_id IS NOT NULL)
);

-- The index the follow-up baseline query runs: the most recent verified encounter for a
-- patient. Partial, because unverified encounters are the majority and are never a
-- baseline for anything.
CREATE INDEX encounter_verified_for_patient_idx
  ON encounter (patient_id, verified_at DESC)
  WHERE verified_at IS NOT NULL;

-- What a delta row is about: the question, document or section it came from.
--
-- The identity of an item is its SOURCE, not its rendered text. An earlier version of this
-- keyed uniqueness on (kind, label) and broke the first time it met a real record: a
-- patient who answers several questions "I am not sure" produces several statements with
-- byte-identical text under one section, and they are different items.
ALTER TABLE follow_up_delta ADD COLUMN item_ref text;

-- A patient cannot both leave an item unchanged and change it.
CREATE UNIQUE INDEX follow_up_delta_one_per_item
  ON follow_up_delta (pre_checkin_id, item_ref)
  WHERE item_ref IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS follow_up_delta_one_per_item;
ALTER TABLE follow_up_delta DROP COLUMN IF EXISTS item_ref;
DROP INDEX IF EXISTS encounter_verified_for_patient_idx;
ALTER TABLE encounter DROP CONSTRAINT IF EXISTS encounter_verification_is_complete;
ALTER TABLE encounter DROP COLUMN IF EXISTS verified_summary_id;
ALTER TABLE encounter DROP COLUMN IF EXISTS verified_by_user_id;
ALTER TABLE encounter DROP COLUMN IF EXISTS verified_at;
DROP INDEX IF EXISTS encounter_one_per_pre_checkin;
ALTER TABLE encounter DROP COLUMN IF EXISTS pre_checkin_id;
