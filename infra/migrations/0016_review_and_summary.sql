-- 0016 — the patient's review of their own answers, and the draft a clinician reads.
--
-- Two safety properties in this file are enforced by CHECK constraints rather than by
-- application code, because they are the properties that make the whole feature safe and
-- application code is one refactor away from stopping enforcing them.

-- Up Migration

-- What the patient confirmed, at the moment they confirmed it. Master prompt §18 lists
-- exactly what must be stored; each column below is one of those items.
CREATE TABLE intake_submission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_checkin_id uuid NOT NULL REFERENCES pre_checkin (id),
  kiosk_session_id uuid REFERENCES kiosk_session (id),
  kiosk_device_id uuid REFERENCES kiosk_device (id),
  consent_id uuid NOT NULL REFERENCES consent (id),

  questionnaire_key text NOT NULL,
  questionnaire_version text NOT NULL,
  ayush_module_version text,
  language_tag text NOT NULL,

  -- The patient pressed "I reviewed and want to submit". This column exists so that
  -- "a patient cannot submit without review confirmation" is a fact about the database
  -- and not a branch someone can delete: an unconfirmed submission row cannot be written.
  review_confirmed boolean NOT NULL CHECK (review_confirmed),
  reviewed_at timestamptz NOT NULL,

  -- The answer revision each question was at when the patient confirmed. A later edit
  -- creates a new revision, so this is how we can tell what they actually reviewed rather
  -- than what the record says today.
  answer_revisions jsonb NOT NULL,
  -- Answers the patient changed ON the review screen, with before and after. The
  -- specification calls these "corrections" and they matter clinically: a patient
  -- correcting "Metformin" to "Metformin, stopped last month" is telling the doctor
  -- something the original answer did not.
  corrections jsonb NOT NULL DEFAULT '[]'::jsonb,

  submitted_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid NOT NULL,

  -- One confirmed submission per visit. A second press of the button is the same
  -- submission, not another one.
  CONSTRAINT intake_submission_one_per_precheckin UNIQUE (pre_checkin_id)
);

CREATE INDEX intake_submission_precheckin_idx ON intake_submission (pre_checkin_id);

-- The narrative a clinician reads before the consultation.
CREATE TABLE clinical_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_checkin_id uuid NOT NULL REFERENCES pre_checkin (id),

  -- DETERMINISTIC: composed from the structured answers by rules, no model involved.
  -- MODEL: produced by a generator behind FEATURE_AI_SUMMARY.
  generator text NOT NULL CHECK (generator IN ('DETERMINISTIC', 'MODEL')),
  generator_version text NOT NULL,

  -- The rendered narrative, plus the structured sections it was built from.
  content jsonb NOT NULL,

  -- Whether the safety validator passed this text. A REJECTED draft is KEPT: it is the
  -- evidence of what a generator tried to put in front of a clinician, and deleting it
  -- would hide exactly the events worth reviewing.
  validation_state text NOT NULL
    CHECK (validation_state IN ('ACCEPTED', 'REJECTED')),
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- The label this draft carries into any view. Phase 11 can write one value and only
  -- one: nothing generated here is verified.
  provenance_label text NOT NULL,

  -- Set only when a clinician confirms the draft, which is Phase 13's job.
  verified_by_user_id text,
  verified_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid NOT NULL,

  -- The constraint that stops a generated narrative ever being presented as verified
  -- clinical truth. CLINICIAN-VERIFIED requires a named clinician and a timestamp;
  -- anything else must carry the draft label. No code path in this phase sets either
  -- verification column, so no row written here can be labelled verified.
  CONSTRAINT clinical_summary_verified_label CHECK (
    (provenance_label = 'CLINICIAN-VERIFIED'
       AND verified_by_user_id IS NOT NULL AND verified_at IS NOT NULL)
    OR
    (provenance_label = 'AI-ASSISTED DRAFT — NOT VERIFIED'
       AND verified_by_user_id IS NULL AND verified_at IS NULL)
  ),

  -- A rejected draft must say why it was rejected. An empty reason list on a rejection
  -- means the validator refused something and nobody can find out what.
  CONSTRAINT clinical_summary_rejected_has_reason CHECK (
    validation_state <> 'REJECTED' OR jsonb_array_length(rejection_reasons) > 0
  )
);

CREATE INDEX clinical_summary_precheckin_idx ON clinical_summary (pre_checkin_id, created_at DESC);

-- Down Migration

DROP INDEX IF EXISTS clinical_summary_precheckin_idx;
DROP TABLE IF EXISTS clinical_summary;
DROP INDEX IF EXISTS intake_submission_precheckin_idx;
DROP TABLE IF EXISTS intake_submission;
