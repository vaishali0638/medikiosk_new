-- 0012 — governed content versions may carry a pre-release suffix.
--
-- Phases 2 and 5 wrote `~ '^\d+\.\d+\.\d+$'`, which is semver's RELEASE form only.
-- Building the questionnaire engine showed why the pre-release form matters: content that
-- has not been through practitioner review must be distinguishable from content that has,
-- at a glance, in every record that references it. `0.1.0-placeholder` says that;
-- `0.1.0` claims the opposite.
--
-- The schema-level rule that makes this load-bearing lives in validateQuestionnaire: a
-- release version with no named approver is refused. So the suffix is not decoration —
-- its absence is a checked claim.

-- Up Migration

ALTER TABLE questionnaire_response DROP CONSTRAINT questionnaire_response_questionnaire_ver_check;
ALTER TABLE questionnaire_response ADD CONSTRAINT questionnaire_response_questionnaire_ver_check
  CHECK (questionnaire_ver ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$');

ALTER TABLE governance_version DROP CONSTRAINT governance_version_semver_check;
ALTER TABLE governance_version ADD CONSTRAINT governance_version_semver_check
  CHECK (semver ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$');

-- Down Migration

ALTER TABLE governance_version DROP CONSTRAINT governance_version_semver_check;
ALTER TABLE governance_version ADD CONSTRAINT governance_version_semver_check
  CHECK (semver ~ '^\d+\.\d+\.\d+$');

ALTER TABLE questionnaire_response DROP CONSTRAINT questionnaire_response_questionnaire_ver_check;
ALTER TABLE questionnaire_response ADD CONSTRAINT questionnaire_response_questionnaire_ver_check
  CHECK (questionnaire_ver ~ '^\d+\.\d+\.\d+$');
