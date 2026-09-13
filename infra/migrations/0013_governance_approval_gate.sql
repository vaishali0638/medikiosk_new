-- 0013 — a published AYUSH module must carry its full approval set.
--
-- The specification requires every AYUSH module to have a qualified practitioner author,
-- a clinical reviewer, a translation reviewer and a safety reviewer, plus an effective
-- date and a rollback pointer. Phase 14 builds the console that collects them.
--
-- This is the backstop underneath it. The application enforces the same rule in far more
-- detail — it checks roles, qualifications and that approvals come from more than one
-- person — but a rule that lives only in application code can be bypassed by a migration,
-- a script, or a future endpoint that forgets to call the service. Clinical content
-- reaching a patient without review is the failure this phase exists to prevent, so the
-- database refuses it too.
--
-- Deliberately coarse: the database checks that four approvals and an effective date
-- exist. It does not try to parse roles out of JSON — that belongs in code, where it can
-- be read and tested.

-- Up Migration

ALTER TABLE governance_version ADD CONSTRAINT governance_version_clinical_approval CHECK (
  state <> 'PUBLISHED'
  OR content_kind NOT IN ('AYUSH_MODULE', 'QUESTIONNAIRE', 'COMPLAINT_BRANCH', 'RED_FLAG_RULE')
  OR (jsonb_array_length(approvals) >= 1 AND effective_from IS NOT NULL)
);

-- An AYUSH module carries the strictest requirement: all four named roles.
ALTER TABLE governance_version ADD CONSTRAINT governance_version_ayush_approval CHECK (
  state <> 'PUBLISHED'
  OR content_kind <> 'AYUSH_MODULE'
  OR jsonb_array_length(approvals) >= 4
);

-- Down Migration

ALTER TABLE governance_version DROP CONSTRAINT IF EXISTS governance_version_ayush_approval;
ALTER TABLE governance_version DROP CONSTRAINT IF EXISTS governance_version_clinical_approval;
