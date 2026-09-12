-- 0005 — clinical intake: questionnaire responses, follow-up deltas, documents,
-- OCR extractions and internal triage status.
--
-- The organising rule of this migration: derived data lives beside the original, never
-- on top of it. An OCR reading is a candidate in its own table, not an edit to a stored
-- record, so nothing machine-produced can be mistaken for verified clinical truth.

-- Up Migration

CREATE TABLE questionnaire_response (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_checkin_id      uuid NOT NULL REFERENCES pre_checkin(id) ON DELETE CASCADE,
  -- Exactly which approved content version asked this question.
  questionnaire_key   text NOT NULL,
  questionnaire_ver   text NOT NULL CHECK (questionnaire_ver ~ '^\d+\.\d+\.\d+$'),
  question_id         text NOT NULL,
  -- Structured answer. Shape is validated against the questionnaire schema at the API
  -- boundary; stored as jsonb so a governed content change does not need a migration.
  answer              jsonb NOT NULL,
  -- Every clinical value carries where it came from and how it was given.
  source              provenance_source NOT NULL,
  modality            answer_modality NOT NULL,
  language_tag        text NOT NULL,
  -- Present for machine-derived answers (ASR, extraction). Null for a touch selection.
  confidence          numeric(4,3) CHECK (confidence >= 0 AND confidence <= 1),
  -- Monotonic per question: a patient editing an answer appends rather than overwrites,
  -- so the review trail shows what changed before submission.
  revision            integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pre_checkin_id, question_id, revision),
  -- A touch selection cannot claim to be AI-derived, and vice versa.
  CONSTRAINT questionnaire_response_confidence_only_for_derived CHECK (
    confidence IS NULL OR source IN ('OCR_EXTRACTED', 'SYSTEM_DETECTED', 'AI_ASSISTED_DRAFT',
                                     'PATIENT_REPORTED')
  )
);

CREATE INDEX questionnaire_response_pre_checkin_idx
  ON questionnaire_response (pre_checkin_id, question_id, revision DESC);

CREATE TABLE follow_up_delta (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_checkin_id          uuid NOT NULL REFERENCES pre_checkin(id) ON DELETE CASCADE,
  -- The baseline is the last CLINICIAN-VERIFIED visit, never the last AI draft. An
  -- unverified draft must not become the history the next visit is measured against.
  previous_encounter_id   uuid NOT NULL REFERENCES encounter(id) ON DELETE RESTRICT,
  previous_verified_at    timestamptz NOT NULL,
  item_kind               text NOT NULL,
  item_label              text NOT NULL,
  change_kind             follow_up_change_kind NOT NULL,
  detail                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  source                  provenance_source NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX follow_up_delta_pre_checkin_idx
  ON follow_up_delta (pre_checkin_id, change_kind);

CREATE TABLE document (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_checkin_id      uuid NOT NULL REFERENCES pre_checkin(id) ON DELETE RESTRICT,
  patient_id          uuid NOT NULL REFERENCES patient(id) ON DELETE RESTRICT,
  document_type       document_type NOT NULL,
  -- Object storage key. The bytes never live in PostgreSQL.
  object_key          text NOT NULL UNIQUE,
  content_type        text NOT NULL,
  byte_size           bigint NOT NULL CHECK (byte_size > 0),
  -- Hash of the ORIGINAL bytes as uploaded. Immutability is provable, not promised.
  sha256              text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  state               document_state NOT NULL DEFAULT 'UPLOAD_PENDING',
  -- Patient-stated date on the document, which may differ from the upload date.
  document_date       date,
  uploaded_at         timestamptz NOT NULL DEFAULT now(),
  malware_scanned_at  timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  -- A document is only STORED once it has actually cleared a malware scan.
  CONSTRAINT document_stored_is_scanned CHECK (
    state <> 'STORED' OR malware_scanned_at IS NOT NULL
  )
);

CREATE INDEX document_pre_checkin_idx ON document (pre_checkin_id);
CREATE INDEX document_patient_idx ON document (patient_id, uploaded_at DESC);

CREATE TABLE ocr_extraction (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  -- Which extraction model/policy version produced this. Needed to re-run or discount
  -- a batch when a model turns out to be miscalibrated.
  extractor_version   text NOT NULL,
  -- Field-level results, each with its own confidence. Deliberately separate from any
  -- clinical record: nothing here updates a medication, allergy or diagnosis.
  fields              jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_text            text,
  overall_confidence  numeric(4,3) CHECK (overall_confidence >= 0 AND overall_confidence <= 1),
  review_state        ocr_review_state NOT NULL DEFAULT 'PENDING',
  reviewed_by         text,
  reviewed_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT ocr_reviewed_has_reviewer CHECK (
    review_state NOT IN ('CLINICIAN_ACCEPTED', 'CLINICIAN_REJECTED')
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX ocr_extraction_document_idx ON ocr_extraction (document_id);
CREATE INDEX ocr_extraction_pending_review_idx ON ocr_extraction (created_at)
  WHERE review_state = 'AWAITING_CLINICIAN_REVIEW';

-- Internal triage status. The patient-facing kiosk has no urgent-help affordance and
-- shows nothing from this table; it exists to drive a hospital's own configured workflow.
CREATE TABLE triage_status (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_checkin_id      uuid NOT NULL REFERENCES pre_checkin(id) ON DELETE CASCADE,
  status              triage_status_kind NOT NULL DEFAULT 'NONE',
  -- The deterministic, hospital-approved rule that fired. Never a model's opinion.
  rule_key            text,
  rule_version        text,
  -- Whether a hospital workflow actually exists for this alert. If not, the alert is
  -- recorded but must not be presented as a clinical safety service.
  workflow_configured boolean NOT NULL DEFAULT false,
  raised_at           timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT triage_alert_names_a_rule CHECK (
    status <> 'INTERNAL_ALERT' OR (rule_key IS NOT NULL AND rule_version IS NOT NULL)
  )
);

CREATE INDEX triage_status_pre_checkin_idx ON triage_status (pre_checkin_id);

CREATE TRIGGER document_updated_at BEFORE UPDATE ON document
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER ocr_extraction_updated_at BEFORE UPDATE ON ocr_extraction
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER document_version BEFORE UPDATE ON document
  FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER ocr_extraction_version BEFORE UPDATE ON ocr_extraction
  FOR EACH ROW EXECUTE FUNCTION bump_row_version();

-- Down Migration

DROP TABLE IF EXISTS triage_status;
DROP TABLE IF EXISTS ocr_extraction;
DROP TABLE IF EXISTS document;
DROP TABLE IF EXISTS follow_up_delta;
DROP TABLE IF EXISTS questionnaire_response;
