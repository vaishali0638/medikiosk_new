/**
 * State and status enumerations shared by the database, the API and every client.
 *
 * These values are mirrored as PostgreSQL enum types in infra/migrations. A drift test
 * (services/core_api/test/enum-parity.spec.ts) asserts the two agree, because a silent
 * mismatch between a stored state and the state machine that guards it would let an
 * invalid transition through.
 */

/** Lifecycle of a single patient's time at a physical kiosk. */
export const KIOSK_SESSION_STATES = [
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
  'ERROR',
] as const;
export type KioskSessionState = (typeof KIOSK_SESSION_STATES)[number];

/** Lifecycle of a pre-check-in started on the patient's own phone. */
export const PRE_CHECKIN_STATES = [
  'DRAFT',
  'SUBMITTED',
  'QR_ISSUED',
  'QR_EXPIRED',
  'ARRIVAL_CONFIRMED',
  'TOKEN_REQUESTED',
  'TOKEN_ISSUED',
  'CONSUMED',
  'CANCELLED',
  'RECONCILIATION_REQUIRED',
] as const;
export type PreCheckinState = (typeof PRE_CHECKIN_STATES)[number];

/**
 * Lifecycle of a request to the hospital HIS/queue for a token.
 * UNKNOWN_RECONCILIATION_REQUIRED is deliberately terminal for the automated path:
 * a human reconciles it rather than the system guessing and issuing a second token.
 */
export const TOKEN_REQUEST_STATES = [
  'NOT_STARTED',
  'REQUESTED',
  'ACKNOWLEDGED',
  'ISSUED',
  'FAILED',
  'UNKNOWN_RECONCILIATION_REQUIRED',
] as const;
export type TokenRequestState = (typeof TOKEN_REQUEST_STATES)[number];

/** Consent lifecycle. Clinical intake may proceed only while consent is GRANTED. */
export const CONSENT_STATES = ['PENDING', 'GRANTED', 'DECLINED', 'EXPIRED', 'REVOKED'] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];

/** How a consent was captured, recorded for audit and evidentiary purposes. */
export const CONSENT_CAPTURE_METHODS = ['KIOSK_TOUCH', 'KIOSK_VOICE', 'MOBILE_PWA'] as const;
export type ConsentCaptureMethod = (typeof CONSENT_CAPTURE_METHODS)[number];

/** Categories of data a consent covers. Consent is purpose- and category-bound. */
export const CONSENT_DATA_CATEGORIES = [
  'demographics',
  'clinical-history',
  'voice-transcript',
  'medical-documents',
  'ai-assisted-draft',
] as const;
export type ConsentDataCategory = (typeof CONSENT_DATA_CATEGORIES)[number];

/** Strength of a patient identity match. Name alone is never sufficient. */
export const IDENTITY_MATCH_STRENGTHS = ['NONE', 'MODERATE', 'STRONG', 'STRONGEST'] as const;
export type IdentityMatchStrength = (typeof IDENTITY_MATCH_STRENGTHS)[number];

/** How a patient was identified. */
export const IDENTITY_METHODS = [
  'UHID_AND_ENCOUNTER',
  'APPOINTMENT_QR',
  'ABHA_VERIFIED',
  'MOBILE_OTP',
] as const;
export type IdentityMethod = (typeof IDENTITY_METHODS)[number];

/** Namespaces for the external identifiers a patient may carry. */
export const PATIENT_IDENTIFIER_TYPES = ['UHID', 'ABHA_NUMBER', 'ABHA_ADDRESS', 'MRN'] as const;
export type PatientIdentifierType = (typeof PATIENT_IDENTIFIER_TYPES)[number];

/** Whether this visit is a first presentation or a scheduled follow-up. */
export const VISIT_TYPES = ['NEW_COMPLAINT', 'REGULAR_FOLLOW_UP'] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

/** AYUSH systems. Only hospital-configured systems are ever offered to a patient. */
export const AYUSH_SYSTEMS = [
  'AYURVEDA',
  'UNANI',
  'SIDDHA',
  'YOGA_NATUROPATHY',
  'SOWA_RIGPA',
  'HOMOEOPATHY',
] as const;
export type AyushSystem = (typeof AYUSH_SYSTEMS)[number];

/** One-time QR reference lifecycle. */
export const QR_NONCE_STATES = ['ISSUED', 'CONSUMED', 'EXPIRED', 'REVOKED'] as const;
export type QrNonceState = (typeof QR_NONCE_STATES)[number];

/** Uploaded document categories. */
export const DOCUMENT_TYPES = [
  'PRESCRIPTION',
  'LAB_REPORT',
  'DISCHARGE_SUMMARY',
  'RADIOLOGY_REPORT',
  'REFERRAL',
  'OTHER',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Document ingest pipeline states. The original is preserved regardless of outcome. */
export const DOCUMENT_STATES = [
  'UPLOAD_PENDING',
  'SCANNING',
  'STORED',
  'REJECTED_MALWARE',
  'REJECTED_INVALID',
] as const;
export type DocumentState = (typeof DOCUMENT_STATES)[number];

/** Review state of an OCR extraction. Nothing reaches the record un-reviewed. */
export const OCR_REVIEW_STATES = [
  'PENDING',
  'AWAITING_CLINICIAN_REVIEW',
  'CLINICIAN_ACCEPTED',
  'CLINICIAN_REJECTED',
  'FAILED',
] as const;
export type OcrReviewState = (typeof OCR_REVIEW_STATES)[number];

/**
 * Provenance of a stored answer or field. This is the machine-readable counterpart of
 * the human labels in @medikiosk/terminology and must be present on every clinical value.
 */
export const PROVENANCE_SOURCES = [
  'PATIENT_REPORTED',
  'PATIENT_SELECTED',
  'SOURCE_DOCUMENT',
  'OCR_EXTRACTED',
  'SYSTEM_DETECTED',
  'AI_ASSISTED_DRAFT',
  'CLINICIAN_VERIFIED',
] as const;
export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number];

/** How an answer was given. */
export const ANSWER_MODALITIES = ['TOUCH', 'VOICE', 'TEXT', 'DOCUMENT', 'IMPORTED'] as const;
export type AnswerModality = (typeof ANSWER_MODALITIES)[number];

/** How a follow-up item compares with the last clinician-verified visit. */
export const STAFF_ROLES = ['CLINICIAN', 'GOVERNANCE_REVIEWER', 'OPERATIONS'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const EXPORT_STATES = [
  'PENDING',
  'SENT',
  'ACKNOWLEDGED',
  'FAILED',
  'RECONCILIATION_REQUIRED',
] as const;
export type ExportState = (typeof EXPORT_STATES)[number];

export const FOLLOW_UP_CHANGE_KINDS = ['UNCHANGED', 'CHANGED', 'NOT_CONFIRMED'] as const;
export type FollowUpChangeKind = (typeof FOLLOW_UP_CHANGE_KINDS)[number];

/** Internal triage status. Never surfaced to the patient as a diagnosis. */
export const TRIAGE_STATUSES = ['NONE', 'ROUTINE', 'INTERNAL_ALERT'] as const;
export type TriageStatus = (typeof TRIAGE_STATUSES)[number];

/** Governance release lifecycle for clinical content. */
export const GOVERNANCE_STATES = [
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'CANARY',
  'PUBLISHED',
  'ROLLED_BACK',
  'RETIRED',
] as const;
export type GovernanceState = (typeof GOVERNANCE_STATES)[number];

/** What a one-time code is being used for. */
export const OTP_PURPOSES = ['NEW_REGISTRATION', 'EXISTING_PATIENT_LOOKUP'] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

/**
 * One-time code lifecycle. LOCKED is reached by exhausting the attempt allowance and is
 * terminal: the patient requests a new code rather than getting more guesses at this one.
 */
export const OTP_STATES = ['PENDING', 'VERIFIED', 'EXPIRED', 'CONSUMED', 'LOCKED'] as const;
export type OtpState = (typeof OTP_STATES)[number];

/** Delivery state of an outbound integration message. */
export const OUTBOX_STATES = [
  'PENDING',
  'IN_FLIGHT',
  'DELIVERED',
  'FAILED',
  'DEAD_LETTER',
] as const;
export type OutboxState = (typeof OUTBOX_STATES)[number];

/**
 * Every PostgreSQL enum type, keyed by its SQL type name. Used by the schema drift test
 * and by the migration generator so the two definitions cannot diverge.
 */
export const SQL_ENUMS = {
  kiosk_session_state: KIOSK_SESSION_STATES,
  pre_checkin_state: PRE_CHECKIN_STATES,
  token_request_state: TOKEN_REQUEST_STATES,
  consent_state: CONSENT_STATES,
  consent_capture_method: CONSENT_CAPTURE_METHODS,
  consent_data_category: CONSENT_DATA_CATEGORIES,
  identity_match_strength: IDENTITY_MATCH_STRENGTHS,
  identity_method: IDENTITY_METHODS,
  patient_identifier_type: PATIENT_IDENTIFIER_TYPES,
  visit_type: VISIT_TYPES,
  ayush_system: AYUSH_SYSTEMS,
  qr_nonce_state: QR_NONCE_STATES,
  document_type: DOCUMENT_TYPES,
  document_state: DOCUMENT_STATES,
  ocr_review_state: OCR_REVIEW_STATES,
  provenance_source: PROVENANCE_SOURCES,
  answer_modality: ANSWER_MODALITIES,
  follow_up_change_kind: FOLLOW_UP_CHANGE_KINDS,
  staff_role: STAFF_ROLES,
  triage_status_kind: TRIAGE_STATUSES,
  governance_state: GOVERNANCE_STATES,
  outbox_state: OUTBOX_STATES,
  otp_purpose: OTP_PURPOSES,
  otp_state: OTP_STATES,
} as const satisfies Record<string, readonly string[]>;

export type SqlEnumName = keyof typeof SQL_ENUMS;
