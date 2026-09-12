-- 0002 — hospital topology, kiosk devices and the governed-content registry.
--
-- Nothing about a hospital is hard-coded in application source. A deployment is
-- configured entirely through these tables plus environment variables.

-- Up Migration

CREATE TABLE hospital (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human-facing hospital code used in QR claims and config, e.g. 'HOSP-001'.
  code             text NOT NULL UNIQUE CHECK (length(code) BETWEEN 1 AND 64),
  name             text NOT NULL,
  -- Feature availability is per hospital: ABHA is only offered where the hospital has
  -- explicitly enabled and approved the integration.
  abha_enabled     boolean NOT NULL DEFAULT false,
  timezone         text NOT NULL DEFAULT 'Asia/Kolkata',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1
);

CREATE TABLE branch (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid NOT NULL REFERENCES hospital(id) ON DELETE RESTRICT,
  code             text NOT NULL CHECK (length(code) BETWEEN 1 AND 64),
  name             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (hospital_id, code)
);

CREATE TABLE department (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id        uuid NOT NULL REFERENCES branch(id) ON DELETE RESTRICT,
  code             text NOT NULL CHECK (length(code) BETWEEN 1 AND 64),
  name             text NOT NULL,
  ayush_system     ayush_system,
  -- A department that is not enabled never appears in kiosk config.
  enabled          boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  UNIQUE (branch_id, code)
);

CREATE TABLE hospital_language (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id          uuid NOT NULL REFERENCES hospital(id) ON DELETE CASCADE,
  language_tag         text NOT NULL CHECK (length(language_tag) BETWEEN 2 AND 16),
  label                text NOT NULL,
  -- Unreviewed translations must never be shown as clinical content. The kiosk reads
  -- this flag and offers only reviewed languages.
  clinically_reviewed  boolean NOT NULL DEFAULT false,
  audio_available      boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1,
  UNIQUE (hospital_id, language_tag)
);

CREATE TABLE kiosk_device (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id        uuid NOT NULL REFERENCES branch(id) ON DELETE RESTRICT,
  -- Device code printed on the enclosure, e.g. 'MK-OPD-03'.
  code             text NOT NULL UNIQUE CHECK (length(code) BETWEEN 1 AND 64),
  -- SHA-256 fingerprint of the device client certificate. The certificate itself is
  -- never stored here; only enough to recognise a known device.
  cert_fingerprint text CHECK (cert_fingerprint ~ '^[a-f0-9]{64}$'),
  enabled          boolean NOT NULL DEFAULT true,
  last_seen_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1
);

-- Governed clinical content: questionnaires, translations, audio prompts, red-flag
-- rules, terminology, OCR policies and summary templates.
CREATE TABLE governance_version (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         uuid NOT NULL REFERENCES hospital(id) ON DELETE RESTRICT,
  content_kind        text NOT NULL CHECK (content_kind IN (
                        'QUESTIONNAIRE', 'AYUSH_MODULE', 'COMPLAINT_BRANCH', 'TRANSLATION',
                        'AUDIO_PROMPT', 'RED_FLAG_RULE', 'TERMINOLOGY', 'MEDICINE_DICTIONARY',
                        'OCR_POLICY', 'SUMMARY_TEMPLATE')),
  content_key         text NOT NULL,
  semver              text NOT NULL CHECK (semver ~ '^\d+\.\d+\.\d+$'),
  state               governance_state NOT NULL DEFAULT 'DRAFT',
  payload             jsonb NOT NULL,
  author_actor_id     text NOT NULL,
  -- Named approvals. A high-risk change requires more than one, enforced in Phase 14.
  approvals           jsonb NOT NULL DEFAULT '[]'::jsonb,
  effective_from      timestamptz,
  -- Points at the version to fall back to. Rollback is a first-class operation.
  rollback_to_id      uuid REFERENCES governance_version(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (hospital_id, content_kind, content_key, semver)
);

-- At most one PUBLISHED version of a given content key per hospital at a time.
CREATE UNIQUE INDEX governance_version_one_published
  ON governance_version (hospital_id, content_kind, content_key)
  WHERE state = 'PUBLISHED';

CREATE INDEX branch_hospital_idx ON branch (hospital_id);
CREATE INDEX department_branch_idx ON department (branch_id);
CREATE INDEX kiosk_device_branch_idx ON kiosk_device (branch_id);

CREATE TRIGGER hospital_updated_at BEFORE UPDATE ON hospital
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER branch_updated_at BEFORE UPDATE ON branch
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER department_updated_at BEFORE UPDATE ON department
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER hospital_language_updated_at BEFORE UPDATE ON hospital_language
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER kiosk_device_updated_at BEFORE UPDATE ON kiosk_device
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER governance_version_updated_at BEFORE UPDATE ON governance_version
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER hospital_version BEFORE UPDATE ON hospital
  FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER branch_version BEFORE UPDATE ON branch
  FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER department_version BEFORE UPDATE ON department
  FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER hospital_language_version BEFORE UPDATE ON hospital_language
  FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER kiosk_device_version BEFORE UPDATE ON kiosk_device
  FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER governance_version_version BEFORE UPDATE ON governance_version
  FOR EACH ROW EXECUTE FUNCTION bump_row_version();

-- Down Migration

DROP TABLE IF EXISTS governance_version;
DROP TABLE IF EXISTS kiosk_device;
DROP TABLE IF EXISTS hospital_language;
DROP TABLE IF EXISTS department;
DROP TABLE IF EXISTS branch;
DROP TABLE IF EXISTS hospital;
