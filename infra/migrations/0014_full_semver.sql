-- 0014 — accept the whole semver grammar, not a fraction of it.
--
-- This is the third migration to widen the same regex, and the reason each time was the
-- same: the original `^\d+\.\d+\.\d+$` encoded release versions only, and every later
-- need turned out to be something semver already has a form for.
--
--   0012 added the PRE-RELEASE segment, for content awaiting practitioner review.
--   0014 adds BUILD METADATA, for a core questionnaire composed with an AYUSH module —
--        `0.1.0-placeholder+ayurveda.1.0.0` is the same core content, built with a module.
--
-- So this migration writes the actual grammar rather than widening it again next phase.

-- Up Migration

ALTER TABLE questionnaire_response DROP CONSTRAINT questionnaire_response_questionnaire_ver_check;
ALTER TABLE questionnaire_response ADD CONSTRAINT questionnaire_response_questionnaire_ver_check
  CHECK (questionnaire_ver ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$');

ALTER TABLE governance_version DROP CONSTRAINT governance_version_semver_check;
ALTER TABLE governance_version ADD CONSTRAINT governance_version_semver_check
  CHECK (semver ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$');

-- Down Migration

ALTER TABLE governance_version DROP CONSTRAINT governance_version_semver_check;
ALTER TABLE governance_version ADD CONSTRAINT governance_version_semver_check
  CHECK (semver ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$');

ALTER TABLE questionnaire_response DROP CONSTRAINT questionnaire_response_questionnaire_ver_check;
ALTER TABLE questionnaire_response ADD CONSTRAINT questionnaire_response_questionnaire_ver_check
  CHECK (questionnaire_ver ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$');
