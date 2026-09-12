-- 0003 — patient records, external identifiers and consent artefacts.

-- Up Migration

CREATE TABLE patient (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         uuid NOT NULL REFERENCES hospital(id) ON DELETE RESTRICT,
  -- A provisional patient exists before identity is confirmed (new registration in
  -- progress). Clinical data is never released to a provisional record.
  provisional         boolean NOT NULL DEFAULT true,
  full_name           text NOT NULL,
  date_of_birth       date,
  age_years           smallint CHECK (age_years BETWEEN 0 AND 130),
  sex                 text NOT NULL CHECK (sex IN ('FEMALE','MALE','OTHER','PREFER_NOT_TO_SAY')),
  mobile              text CHECK (mobile ~ '^[6-9][0-9]{9}$'),
  email               text,
  address             text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  -- A patient must be locatable by something. Age or DOB, and a contact route.
  CONSTRAINT patient_has_age_or_dob CHECK (date_of_birth IS NOT NULL OR age_years IS NOT NULL)
);

-- Supports the supervised duplicate-candidate search. Name is never sufficient on its
-- own to resolve a patient; this index only ever narrows a set for human confirmation.
CREATE INDEX patient_name_trgm_idx ON patient USING gin (full_name gin_trgm_ops);
CREATE INDEX patient_mobile_idx ON patient (hospital_id, mobile) WHERE mobile IS NOT NULL;

CREATE TABLE patient_identifier (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          uuid NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  type                patient_identifier_type NOT NULL,
  value               text NOT NULL CHECK (length(value) BETWEEN 1 AND 128),
  -- A UHID is only unique within the facility that issued it.
  issued_by           uuid NOT NULL REFERENCES hospital(id) ON DELETE RESTRICT,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issued_by, type, value)
);

CREATE INDEX patient_identifier_patient_idx ON patient_identifier (patient_id);

CREATE TABLE consent (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          uuid NOT NULL REFERENCES patient(id) ON DELETE RESTRICT,
  hospital_id         uuid NOT NULL REFERENCES hospital(id) ON DELETE RESTRICT,
  -- Consent is purpose-bound. The purpose is stored, not assumed.
  purpose             text NOT NULL,
  -- cardinality(), not array_length(): array_length('{}', 1) is NULL and a NULL CHECK
  -- passes, which would let a consent through covering nothing at all.
  data_categories     consent_data_category[] NOT NULL
                        CONSTRAINT consent_has_data_category
                        CHECK (cardinality(data_categories) >= 1),
  language_tag        text NOT NULL,
  -- Exactly which notice text the patient was shown, so it can be reconstructed later.
  notice_version      text NOT NULL,
  state               consent_state NOT NULL DEFAULT 'PENDING',
  capture_method      consent_capture_method NOT NULL,
  kiosk_device_id     uuid REFERENCES kiosk_device(id) ON DELETE SET NULL,
  captured_at         timestamptz NOT NULL DEFAULT now(),
  valid_until         timestamptz NOT NULL,
  -- Set when the patient withdraws. Withdrawal is never a silent delete.
  revoked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT consent_validity_window CHECK (valid_until > captured_at),
  CONSTRAINT consent_revoked_state CHECK (
    (state = 'REVOKED') = (revoked_at IS NOT NULL)
  )
);

CREATE INDEX consent_patient_idx ON consent (patient_id, state);
-- Fast lookup of the consent that currently authorises processing for a patient.
CREATE INDEX consent_active_idx ON consent (patient_id, valid_until)
  WHERE state = 'GRANTED';

CREATE TRIGGER patient_updated_at BEFORE UPDATE ON patient
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER consent_updated_at BEFORE UPDATE ON consent
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER patient_version BEFORE UPDATE ON patient
  FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER consent_version BEFORE UPDATE ON consent
  FOR EACH ROW EXECUTE FUNCTION bump_row_version();

-- Down Migration

DROP TABLE IF EXISTS consent;
DROP TABLE IF EXISTS patient_identifier;
DROP TABLE IF EXISTS patient;
