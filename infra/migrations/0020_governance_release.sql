-- 0020 — the release workflow around content that was already versioned.
--
-- Phase 9 built the approval GATE: a function that says whether a candidate carries the
-- named approvals its content kind requires, plus coarse CHECK constraints. What was
-- missing is everything around it — who published, when, to which kiosks, and what a
-- rollback actually does. A gate nobody has to walk through is a suggestion.

-- Up Migration

-- Who published it and when. Both or neither: a live version whose publisher is unknown
-- cannot be reviewed after an incident, which is the moment anyone looks.
ALTER TABLE governance_version ADD COLUMN published_by_user_id text;
ALTER TABLE governance_version ADD COLUMN published_at timestamptz;

ALTER TABLE governance_version ADD CONSTRAINT governance_version_publication_is_attributed CHECK (
  (published_by_user_id IS NULL AND published_at IS NULL)
  OR (published_by_user_id IS NOT NULL AND published_at IS NOT NULL)
);

-- Content published BEFORE this migration has no recorded publisher, because until now
-- nothing captured one. Three ways out, and only one of them is honest:
--
--   - Fail the migration. Then the constraint can never be applied to a database anybody
--     has actually used, which is every database that matters.
--   - Move those rows out of PUBLISHED. That unpublishes a hospital's live consent notice
--     during an upgrade — the patient-facing failure this whole phase exists to prevent.
--   - Record what is true: it was published before the system recorded publishers.
--
-- The marker is deliberately not a person's name and not a plausible user id, for the same
-- reason the seed writes NOT_A_REAL_APPROVAL: an attribution nobody can be asked about must
-- not read like one that can. `published_at` takes the row's creation time rather than now(),
-- so the timeline stays true.
UPDATE governance_version
   SET published_by_user_id = 'PRE-ATTRIBUTION-MIGRATION',
       published_at = COALESCE(published_at, created_at)
 WHERE state IN ('PUBLISHED', 'CANARY')
   AND published_by_user_id IS NULL;

-- Nothing may be live without a publisher. The states below PUBLISHED are working states
-- and carry no attribution; PUBLISHED and CANARY are in front of patients and must.
ALTER TABLE governance_version ADD CONSTRAINT governance_version_live_is_published CHECK (
  state NOT IN ('PUBLISHED', 'CANARY') OR published_by_user_id IS NOT NULL
);

-- Which kiosks a canary reaches. Empty means every kiosk, which is what a full release is.
--
-- Device CODES rather than ids: this is written by a human in a console, from the label on
-- the front of the machine, and a uuid typed from a sticker is a uuid typed wrong.
ALTER TABLE governance_version ADD COLUMN canary_kiosk_codes text[] NOT NULL DEFAULT '{}';

ALTER TABLE governance_version ADD CONSTRAINT governance_version_canary_has_scope CHECK (
  state <> 'CANARY' OR cardinality(canary_kiosk_codes) > 0
);

-- Why a version was withdrawn, and by whom. A rollback with no stated reason tells the
-- next reviewer nothing about whether the problem was ever fixed.
ALTER TABLE governance_version ADD COLUMN rolled_back_at timestamptz;
ALTER TABLE governance_version ADD COLUMN rolled_back_by_user_id text;
ALTER TABLE governance_version ADD COLUMN rollback_reason text;

ALTER TABLE governance_version ADD CONSTRAINT governance_version_rollback_is_explained CHECK (
  state <> 'ROLLED_BACK'
  OR (rolled_back_at IS NOT NULL
      AND rolled_back_by_user_id IS NOT NULL
      AND length(btrim(rollback_reason)) >= 10)
);

-- Note: `governance_version_one_published` already exists from migration 0002, and it
-- already says what this phase needs — at most one PUBLISHED version per key, so "which
-- questionnaire is live" has one answer. It deliberately does not cover CANARY, because a
-- canary runs alongside the published version, which is the entire point of one.

-- Every state change, appended. The audit log records that a release happened; this
-- records the shape of the whole review, which is what a governance committee reads.
CREATE TABLE governance_transition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  governance_version_id uuid NOT NULL REFERENCES governance_version (id) ON DELETE CASCADE,
  from_state governance_state,
  to_state governance_state NOT NULL,
  actor_user_id text NOT NULL,
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid NOT NULL
);

CREATE INDEX governance_transition_version_idx
  ON governance_transition (governance_version_id, occurred_at);

-- Down Migration

DROP INDEX IF EXISTS governance_transition_version_idx;
DROP TABLE IF EXISTS governance_transition;
ALTER TABLE governance_version DROP CONSTRAINT IF EXISTS governance_version_rollback_is_explained;
ALTER TABLE governance_version DROP COLUMN IF EXISTS rollback_reason;
ALTER TABLE governance_version DROP COLUMN IF EXISTS rolled_back_by_user_id;
ALTER TABLE governance_version DROP COLUMN IF EXISTS rolled_back_at;
ALTER TABLE governance_version DROP CONSTRAINT IF EXISTS governance_version_canary_has_scope;
ALTER TABLE governance_version DROP COLUMN IF EXISTS canary_kiosk_codes;
ALTER TABLE governance_version DROP CONSTRAINT IF EXISTS governance_version_live_is_published;
ALTER TABLE governance_version DROP CONSTRAINT IF EXISTS governance_version_publication_is_attributed;
ALTER TABLE governance_version DROP COLUMN IF EXISTS published_at;
ALTER TABLE governance_version DROP COLUMN IF EXISTS published_by_user_id;
