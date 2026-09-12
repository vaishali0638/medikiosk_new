-- 0008 — mobile OTP verification and identity match auditing.
--
-- Wrong-patient identification is the highest-consequence failure in this system: it puts
-- one person's history in front of another person's doctor. The controls here are built
-- so that being unsure produces a refusal, never a guess.

-- Up Migration

CREATE TYPE otp_purpose AS ENUM ('NEW_REGISTRATION', 'EXISTING_PATIENT_LOOKUP');

CREATE TYPE otp_state AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'CONSUMED', 'LOCKED');

CREATE TABLE otp_verification (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         uuid NOT NULL REFERENCES hospital(id) ON DELETE RESTRICT,
  kiosk_device_id     uuid REFERENCES kiosk_device(id) ON DELETE SET NULL,
  purpose             otp_purpose NOT NULL,
  mobile              text NOT NULL CHECK (mobile ~ '^[6-9][0-9]{9}$'),
  -- HMAC-SHA256 of the code, never the code. A database dump must not hand an attacker
  -- live one-time codes, and an operator reading a row must not be able to impersonate
  -- a patient mid-flow.
  code_hash           text NOT NULL CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  -- Names the key used, so the signing secret can be rotated without invalidating
  -- codes that are already in flight.
  code_key_id         text NOT NULL,
  state               otp_state NOT NULL DEFAULT 'PENDING',
  attempt_count       integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts        integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  sent_at             timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  verified_at         timestamptz,
  -- Set when the verification is spent on a successful identity match, so one code
  -- cannot be replayed to confirm a second identity.
  consumed_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CONSTRAINT otp_expiry_after_send CHECK (expires_at > sent_at),
  CONSTRAINT otp_verified_state CHECK (
    (state IN ('VERIFIED', 'CONSUMED')) = (verified_at IS NOT NULL)
  ),
  CONSTRAINT otp_consumed_state CHECK ((state = 'CONSUMED') = (consumed_at IS NOT NULL))
);

-- One live code per mobile per purpose. Re-sending supersedes rather than accumulates,
-- so a patient cannot end up with several simultaneously valid codes.
CREATE UNIQUE INDEX otp_one_live_per_mobile
  ON otp_verification (hospital_id, mobile, purpose)
  WHERE state = 'PENDING';

-- Drives send-rate limiting: how many codes went to this number recently.
CREATE INDEX otp_mobile_recent_idx ON otp_verification (hospital_id, mobile, sent_at DESC);
CREATE INDEX otp_expiry_sweep_idx ON otp_verification (expires_at) WHERE state = 'PENDING';

-- Every identity lookup and confirmation, whether or not it succeeded.
--
-- Separate from audit_event because these rows are queried as a set — "how often is this
-- kiosk failing to match?", "did anyone probe this UHID?" — and because a failed lookup
-- must be recorded just as carefully as a successful one.
CREATE TABLE identity_attempt (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         uuid NOT NULL REFERENCES hospital(id) ON DELETE RESTRICT,
  kiosk_device_id     uuid REFERENCES kiosk_device(id) ON DELETE SET NULL,
  kiosk_session_id    uuid REFERENCES kiosk_session(id) ON DELETE SET NULL,
  method              identity_method NOT NULL,
  strength            identity_match_strength NOT NULL,
  -- How many patients the lookup matched. Anything other than 1 must not resolve.
  candidate_count     integer NOT NULL CHECK (candidate_count >= 0),
  -- Populated only on a resolved, confirmed match.
  matched_patient_id  uuid REFERENCES patient(id) ON DELETE SET NULL,
  confirmed           boolean NOT NULL DEFAULT false,
  -- Structured reason for a refusal, e.g. 'AMBIGUOUS', 'NOT_FOUND', 'OTP_INVALID'.
  outcome             text NOT NULL,
  correlation_id      uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- A patient is only attached to an attempt that actually resolved to one.
  CONSTRAINT identity_match_needs_single_candidate CHECK (
    matched_patient_id IS NULL OR candidate_count = 1
  ),
  -- Confirmation is meaningless without a matched patient.
  CONSTRAINT identity_confirmed_needs_patient CHECK (
    NOT confirmed OR matched_patient_id IS NOT NULL
  )
);

CREATE INDEX identity_attempt_session_idx ON identity_attempt (kiosk_session_id);
CREATE INDEX identity_attempt_device_idx ON identity_attempt (kiosk_device_id, created_at DESC);
CREATE INDEX identity_attempt_outcome_idx ON identity_attempt (outcome, created_at DESC);

CREATE TRIGGER otp_verification_updated_at BEFORE UPDATE ON otp_verification
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER otp_verification_version BEFORE UPDATE ON otp_verification
  FOR EACH ROW EXECUTE FUNCTION bump_row_version();

-- Down Migration

DROP TABLE IF EXISTS identity_attempt;
DROP TABLE IF EXISTS otp_verification;
DROP TYPE IF EXISTS otp_state;
DROP TYPE IF EXISTS otp_purpose;
