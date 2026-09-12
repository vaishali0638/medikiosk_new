-- 0007 — allow provisional patients, and make consent notices first-class governed content.
--
-- Two corrections that only became visible once the real consent flow was built.
--
-- 1. The specified order is language -> consent -> identity: a patient consents BEFORE
--    they are identified. But `patient` required full_name, sex and an age or date of
--    birth, so the provisional row a consent must reference could not be created. The
--    `provisional` flag already existed; the constraints simply did not respect it.
--    They are now conditional, and a patient cannot LEAVE provisional state without the
--    demographics — so the guarantee is preserved exactly where it matters.
--
-- 2. A consent notice is governed clinical-adjacent content with its own review and
--    approval, not a terminology entry. It gets its own content kind.

-- Up Migration

ALTER TABLE patient ALTER COLUMN full_name DROP NOT NULL;
ALTER TABLE patient ALTER COLUMN sex DROP NOT NULL;

ALTER TABLE patient DROP CONSTRAINT patient_has_age_or_dob;

-- A confirmed patient still needs a name, a sex and an age or date of birth. A
-- provisional one — created to anchor a consent artefact before identity is known —
-- needs none of them.
ALTER TABLE patient ADD CONSTRAINT patient_confirmed_has_demographics CHECK (
  provisional
  OR (
    full_name IS NOT NULL
    AND sex IS NOT NULL
    AND (date_of_birth IS NOT NULL OR age_years IS NOT NULL)
  )
);

-- Provisional patients are short-lived: either identity resolves and they are promoted,
-- or the session ends and they are swept. This index drives that sweep.
CREATE INDEX patient_provisional_idx ON patient (created_at) WHERE provisional;

ALTER TABLE governance_version DROP CONSTRAINT governance_version_content_kind_check;
ALTER TABLE governance_version ADD CONSTRAINT governance_version_content_kind_check CHECK (
  content_kind IN (
    'QUESTIONNAIRE', 'AYUSH_MODULE', 'COMPLAINT_BRANCH', 'TRANSLATION',
    'AUDIO_PROMPT', 'RED_FLAG_RULE', 'TERMINOLOGY', 'MEDICINE_DICTIONARY',
    'OCR_POLICY', 'SUMMARY_TEMPLATE', 'CONSENT_NOTICE'
  )
);

-- A consent notice is published per language: the patient must be shown, and consent
-- against, wording in the language they actually read. `content_key` carries the language
-- tag, e.g. 'consent-notice/hi'.

-- Down Migration

ALTER TABLE governance_version DROP CONSTRAINT governance_version_content_kind_check;
ALTER TABLE governance_version ADD CONSTRAINT governance_version_content_kind_check CHECK (
  content_kind IN (
    'QUESTIONNAIRE', 'AYUSH_MODULE', 'COMPLAINT_BRANCH', 'TRANSLATION',
    'AUDIO_PROMPT', 'RED_FLAG_RULE', 'TERMINOLOGY', 'MEDICINE_DICTIONARY',
    'OCR_POLICY', 'SUMMARY_TEMPLATE'
  )
);

DROP INDEX IF EXISTS patient_provisional_idx;
ALTER TABLE patient DROP CONSTRAINT patient_confirmed_has_demographics;
ALTER TABLE patient ADD CONSTRAINT patient_has_age_or_dob CHECK (
  date_of_birth IS NOT NULL OR age_years IS NOT NULL
);
ALTER TABLE patient ALTER COLUMN sex SET NOT NULL;
ALTER TABLE patient ALTER COLUMN full_name SET NOT NULL;
