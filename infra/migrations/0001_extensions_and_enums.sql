-- 0001 — extensions, shared functions and enum types.
--
-- Enum labels mirror packages/api_contracts/src/enums.ts. A parity test asserts the two
-- agree; if they drift, a stored state could name a value the state machine has never
-- heard of and the transition guard would be bypassed.

-- Up Migration

-- gen_random_uuid() is built in from PostgreSQL 13; pgcrypto is still needed for digest().
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Trigram index support for the supervised duplicate-candidate search (Phase 5).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Keeps updated_at honest without every writer having to remember it.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Optimistic concurrency: any UPDATE bumps the row version, so a caller holding a stale
-- read cannot silently overwrite a concurrent change to consent, arrival or token state.
CREATE OR REPLACE FUNCTION bump_row_version() RETURNS trigger AS $$
BEGIN
  NEW.version = OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TYPE kiosk_session_state AS ENUM (
  'CREATED',
  'LANGUAGE_SELECTED',
  'CONSENT_PENDING',
  'CONSENT_GRANTED',
  'IDENTITY_PENDING',
  'IDENTITY_CONFIRMED',
  'INTAKE_IN_PROGRESS',
  'REVIEW_PENDING',
  'SUBMITTED',
  'TOKEN_PENDING',
  'TOKEN_ISSUED',
  'EXITED',
  'EXPIRED',
  'ERROR'
);

CREATE TYPE pre_checkin_state AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'QR_ISSUED',
  'QR_EXPIRED',
  'ARRIVAL_CONFIRMED',
  'TOKEN_REQUESTED',
  'TOKEN_ISSUED',
  'CONSUMED',
  'CANCELLED',
  'RECONCILIATION_REQUIRED'
);

CREATE TYPE token_request_state AS ENUM (
  'NOT_STARTED',
  'REQUESTED',
  'ACKNOWLEDGED',
  'ISSUED',
  'FAILED',
  'UNKNOWN_RECONCILIATION_REQUIRED'
);

CREATE TYPE consent_state AS ENUM (
  'PENDING',
  'GRANTED',
  'DECLINED',
  'EXPIRED',
  'REVOKED'
);

CREATE TYPE consent_capture_method AS ENUM (
  'KIOSK_TOUCH',
  'KIOSK_VOICE',
  'MOBILE_PWA'
);

CREATE TYPE consent_data_category AS ENUM (
  'demographics',
  'clinical-history',
  'voice-transcript',
  'medical-documents',
  'ai-assisted-draft'
);

CREATE TYPE identity_match_strength AS ENUM (
  'NONE',
  'MODERATE',
  'STRONG',
  'STRONGEST'
);

CREATE TYPE identity_method AS ENUM (
  'UHID_AND_ENCOUNTER',
  'APPOINTMENT_QR',
  'ABHA_VERIFIED',
  'MOBILE_OTP'
);

CREATE TYPE patient_identifier_type AS ENUM (
  'UHID',
  'ABHA_NUMBER',
  'ABHA_ADDRESS',
  'MRN'
);

CREATE TYPE visit_type AS ENUM (
  'NEW_COMPLAINT',
  'REGULAR_FOLLOW_UP'
);

CREATE TYPE ayush_system AS ENUM (
  'AYURVEDA',
  'UNANI',
  'SIDDHA',
  'YOGA_NATUROPATHY',
  'SOWA_RIGPA',
  'HOMOEOPATHY'
);

CREATE TYPE qr_nonce_state AS ENUM (
  'ISSUED',
  'CONSUMED',
  'EXPIRED',
  'REVOKED'
);

CREATE TYPE document_type AS ENUM (
  'PRESCRIPTION',
  'LAB_REPORT',
  'DISCHARGE_SUMMARY',
  'RADIOLOGY_REPORT',
  'REFERRAL',
  'OTHER'
);

CREATE TYPE document_state AS ENUM (
  'UPLOAD_PENDING',
  'SCANNING',
  'STORED',
  'REJECTED_MALWARE',
  'REJECTED_INVALID'
);

CREATE TYPE ocr_review_state AS ENUM (
  'PENDING',
  'AWAITING_CLINICIAN_REVIEW',
  'CLINICIAN_ACCEPTED',
  'CLINICIAN_REJECTED',
  'FAILED'
);

CREATE TYPE provenance_source AS ENUM (
  'PATIENT_REPORTED',
  'PATIENT_SELECTED',
  'SOURCE_DOCUMENT',
  'OCR_EXTRACTED',
  'SYSTEM_DETECTED',
  'AI_ASSISTED_DRAFT',
  'CLINICIAN_VERIFIED'
);

CREATE TYPE answer_modality AS ENUM (
  'TOUCH',
  'VOICE',
  'TEXT',
  'DOCUMENT',
  'IMPORTED'
);

CREATE TYPE follow_up_change_kind AS ENUM (
  'UNCHANGED',
  'CHANGED',
  'NOT_CONFIRMED'
);

CREATE TYPE triage_status_kind AS ENUM (
  'NONE',
  'ROUTINE',
  'INTERNAL_ALERT'
);

CREATE TYPE governance_state AS ENUM (
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'CANARY',
  'PUBLISHED',
  'ROLLED_BACK',
  'RETIRED'
);

CREATE TYPE outbox_state AS ENUM (
  'PENDING',
  'IN_FLIGHT',
  'DELIVERED',
  'FAILED',
  'DEAD_LETTER'
);

-- Down Migration

DROP FUNCTION IF EXISTS bump_row_version();
DROP FUNCTION IF EXISTS set_updated_at();

DROP TYPE IF EXISTS outbox_state;
DROP TYPE IF EXISTS governance_state;
DROP TYPE IF EXISTS triage_status_kind;
DROP TYPE IF EXISTS follow_up_change_kind;
DROP TYPE IF EXISTS answer_modality;
DROP TYPE IF EXISTS provenance_source;
DROP TYPE IF EXISTS ocr_review_state;
DROP TYPE IF EXISTS document_state;
DROP TYPE IF EXISTS document_type;
DROP TYPE IF EXISTS qr_nonce_state;
DROP TYPE IF EXISTS ayush_system;
DROP TYPE IF EXISTS visit_type;
DROP TYPE IF EXISTS patient_identifier_type;
DROP TYPE IF EXISTS identity_method;
DROP TYPE IF EXISTS identity_match_strength;
DROP TYPE IF EXISTS consent_data_category;
DROP TYPE IF EXISTS consent_capture_method;
DROP TYPE IF EXISTS consent_state;
DROP TYPE IF EXISTS token_request_state;
DROP TYPE IF EXISTS pre_checkin_state;
DROP TYPE IF EXISTS kiosk_session_state;

