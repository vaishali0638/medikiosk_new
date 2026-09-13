import type {
  AnswerModality,
  IdentityMatchStrength,
  IdentityMethod,
  OtpPurpose,
  OtpState,
  AyushSystem,
  ConsentCaptureMethod,
  ConsentDataCategory,
  ConsentState,
  DocumentState,
  DocumentType,
  FollowUpChangeKind,
  GovernanceState,
  KioskSessionState,
  OcrReviewState,
  OutboxState,
  PatientIdentifierType,
  PreCheckinState,
  ProvenanceSource,
  QrNonceState,
  TokenRequestState,
  TriageStatus,
  VisitType,
} from '@medikiosk/api-contracts';
import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

/** Written by the database default and never by the application. */
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
/** Set by a trigger; the application never supplies or updates it. */
type ManagedTimestamp = ColumnType<Date, never, never>;
/** Bumped by a trigger on every UPDATE. Read-only to the application. */
type RowVersion = ColumnType<number, never, never>;

export interface HospitalTable {
  id: Generated<string>;
  code: string;
  name: string;
  abha_enabled: Generated<boolean>;
  timezone: Generated<string>;
  created_at: Generated<Date>;
  updated_at: ManagedTimestamp;
  version: RowVersion;
}

export interface BranchTable {
  id: Generated<string>;
  hospital_id: string;
  code: string;
  name: string;
  created_at: Generated<Date>;
  updated_at: ManagedTimestamp;
  version: RowVersion;
}

export interface DepartmentTable {
  id: Generated<string>;
  branch_id: string;
  code: string;
  name: string;
  ayush_system: AyushSystem | null;
  enabled: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: ManagedTimestamp;
  version: RowVersion;
}

export interface HospitalLanguageTable {
  id: Generated<string>;
  hospital_id: string;
  language_tag: string;
  label: string;
  clinically_reviewed: Generated<boolean>;
  audio_available: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: ManagedTimestamp;
  version: RowVersion;
}

export interface KioskDeviceTable {
  id: Generated<string>;
  branch_id: string;
  code: string;
  cert_fingerprint: string | null;
  enabled: Generated<boolean>;
  last_seen_at: Date | null;
  created_at: Generated<Date>;
  updated_at: ManagedTimestamp;
  version: RowVersion;
}

export interface GovernanceVersionTable {
  id: Generated<string>;
  hospital_id: string;
  content_kind: string;
  content_key: string;
  semver: string;
  state: Generated<GovernanceState>;
  payload: unknown;
  author_actor_id: string;
  approvals: Generated<unknown>;
  effective_from: Date | null;
  rollback_to_id: string | null;
  created_at: Generated<Date>;
  updated_at: ManagedTimestamp;
  version: RowVersion;
}

export interface PatientTable {
  id: Generated<string>;
  hospital_id: string;
  provisional: Generated<boolean>;
  // Null only while provisional. `patient_confirmed_has_demographics` requires all of
  // these before a patient can leave provisional state.
  full_name: string | null;
  date_of_birth: Date | null;
  age_years: number | null;
  sex: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  created_at: Generated<Date>;
  updated_at: ManagedTimestamp;
  version: RowVersion;
}

export interface PatientIdentifierTable {
  id: Generated<string>;
  patient_id: string;
  type: PatientIdentifierType;
  value: string;
  issued_by: string;
  created_at: Generated<Date>;
}

export interface ConsentTable {
  id: Generated<string>;
  patient_id: string;
  hospital_id: string;
  purpose: string;
  data_categories: ConsentDataCategory[];
  language_tag: string;
  notice_version: string;
  state: Generated<ConsentState>;
  capture_method: ConsentCaptureMethod;
  kiosk_device_id: string | null;
  captured_at: Generated<Date>;
  valid_until: Timestamp;
  revoked_at: Date | null;
  created_at: Generated<Date>;
  updated_at: ManagedTimestamp;
  version: RowVersion;
}

export interface EncounterTable {
  id: Generated<string>;
  patient_id: string;
  department_id: string;
  visit_type: VisitType;
  ayush_system: AyushSystem | null;
  his_encounter_ref: string | null;
  his_token: string | null;
  token_issued_at: Date | null;
  created_at: Generated<Date>;
  updated_at: ManagedTimestamp;
  version: RowVersion;
}

export interface PreCheckinTable {
  id: Generated<string>;
  patient_id: string;
  consent_id: string;
  hospital_id: string;
  branch_id: string;
  department_id: string;
  encounter_id: string | null;
  visit_type: VisitType;
  appointment_ref: string | null;
  visit_window_start: Timestamp;
  visit_window_end: Timestamp;
  state: Generated<PreCheckinState>;
  submitted_at: Date | null;
  arrival_confirmed_at: Date | null;
  arrival_kiosk_id: string | null;
  /** Short-lived handle bridging the QR scan and the patient's confirmation. */
  arrival_handle: string | null;
  arrival_handle_expires_at: Date | null;
  created_at: Generated<Date>;
  updated_at: ManagedTimestamp;
  version: RowVersion;
}

export interface KioskSessionTable {
  id: Generated<string>;
  kiosk_device_id: string;
  patient_id: string | null;
  pre_checkin_id: string | null;
  state: Generated<KioskSessionState>;
  language_tag: string | null;
  started_at: Generated<Date>;
  last_activity_at: Generated<Date>;
  ended_at: Date | null;
  wiped_at: Date | null;
  created_at: Generated<Date>;
  updated_at: ManagedTimestamp;
  version: RowVersion;
}

export interface QrNonceTable {
  id: Generated<string>;
  pre_checkin_id: string;
  nonce: string;
  signing_key_id: string;
  state: Generated<QrNonceState>;
  issued_at: Generated<Date>;
  expires_at: Timestamp;
  consumed_at: Date | null;
  consumed_by_kiosk: string | null;
  created_at: Generated<Date>;
}

export interface TokenRequestTable {
  id: Generated<string>;
  pre_checkin_id: string;
  encounter_id: string | null;
  kiosk_device_id: string;
  idempotency_key: string;
  state: Generated<TokenRequestState>;
  attempt_count: Generated<number>;
  his_token: string | null;
  his_response_ref: string | null;
  /** Where to go and where they stand in the queue, as the HIS reported them. */
  room: string | null;
  queue_status: string | null;
  last_latency_ms: number | null;
  last_error_code: string | null;
  requested_at: Date | null;
  acknowledged_at: Date | null;
  issued_at: Date | null;
  reconciliation_note: string | null;
  created_at: Generated<Date>;
  updated_at: ManagedTimestamp;
  version: RowVersion;
}

export interface QuestionnaireResponseTable {
  id: Generated<string>;
  pre_checkin_id: string;
  questionnaire_key: string;
  questionnaire_ver: string;
  question_id: string;
  answer: unknown;
  source: ProvenanceSource;
  modality: AnswerModality;
  language_tag: string;
  confidence: number | null;
  revision: Generated<number>;
  created_at: Generated<Date>;
}

export interface FollowUpDeltaTable {
  id: Generated<string>;
  pre_checkin_id: string;
  previous_encounter_id: string;
  previous_verified_at: Timestamp;
  item_kind: string;
  item_label: string;
  change_kind: FollowUpChangeKind;
  detail: Generated<unknown>;
  source: ProvenanceSource;
  created_at: Generated<Date>;
}

export interface DocumentTable {
  id: Generated<string>;
  pre_checkin_id: string;
  patient_id: string;
  document_type: DocumentType;
  object_key: string;
  content_type: string;
  byte_size: string;
  sha256: string;
  state: Generated<DocumentState>;
  document_date: Date | null;
  uploaded_at: Generated<Date>;
  malware_scanned_at: Date | null;
  created_at: Generated<Date>;
  updated_at: ManagedTimestamp;
  version: RowVersion;
}

export interface OcrExtractionTable {
  id: Generated<string>;
  document_id: string;
  extractor_version: string;
  fields: Generated<unknown>;
  raw_text: string | null;
  overall_confidence: number | null;
  review_state: Generated<OcrReviewState>;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Generated<Date>;
  updated_at: ManagedTimestamp;
  version: RowVersion;
}

export interface TriageStatusTable {
  id: Generated<string>;
  pre_checkin_id: string;
  status: Generated<TriageStatus>;
  rule_key: string | null;
  rule_version: string | null;
  workflow_configured: Generated<boolean>;
  raised_at: Generated<Date>;
  created_at: Generated<Date>;
}

export interface OtpVerificationTable {
  id: Generated<string>;
  hospital_id: string;
  kiosk_device_id: string | null;
  purpose: OtpPurpose;
  mobile: string;
  code_hash: string;
  code_key_id: string;
  state: Generated<OtpState>;
  attempt_count: Generated<number>;
  max_attempts: Generated<number>;
  sent_at: Generated<Date>;
  expires_at: Timestamp;
  verified_at: Date | null;
  consumed_at: Date | null;
  created_at: Generated<Date>;
  updated_at: ManagedTimestamp;
  version: RowVersion;
}

export interface IdentityAttemptTable {
  id: Generated<string>;
  hospital_id: string;
  kiosk_device_id: string | null;
  kiosk_session_id: string | null;
  method: IdentityMethod;
  strength: IdentityMatchStrength;
  candidate_count: number;
  matched_patient_id: string | null;
  confirmed: Generated<boolean>;
  outcome: string;
  correlation_id: string;
  created_at: Generated<Date>;
}

export interface AuditEventTable {
  id: Generated<string>;
  occurred_at: Generated<Date>;
  actor_id: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  correlation_id: string;
  reason: string | null;
  detail: Generated<unknown>;
}

export interface IntegrationOutboxTable {
  id: Generated<string>;
  channel: string;
  idempotency_key: string;
  payload: unknown;
  state: Generated<OutboxState>;
  attempt_count: Generated<number>;
  next_attempt_at: Generated<Date>;
  last_error_code: string | null;
  delivered_at: Date | null;
  correlation_id: string;
  created_at: Generated<Date>;
  updated_at: ManagedTimestamp;
  version: RowVersion;
}

/** The full schema as Kysely sees it. Table keys match the SQL table names exactly. */
export interface Database {
  hospital: HospitalTable;
  branch: BranchTable;
  department: DepartmentTable;
  hospital_language: HospitalLanguageTable;
  kiosk_device: KioskDeviceTable;
  governance_version: GovernanceVersionTable;
  patient: PatientTable;
  patient_identifier: PatientIdentifierTable;
  consent: ConsentTable;
  encounter: EncounterTable;
  pre_checkin: PreCheckinTable;
  kiosk_session: KioskSessionTable;
  qr_nonce: QrNonceTable;
  token_request: TokenRequestTable;
  questionnaire_response: QuestionnaireResponseTable;
  follow_up_delta: FollowUpDeltaTable;
  document: DocumentTable;
  ocr_extraction: OcrExtractionTable;
  triage_status: TriageStatusTable;
  otp_verification: OtpVerificationTable;
  identity_attempt: IdentityAttemptTable;
  audit_event: AuditEventTable;
  integration_outbox: IntegrationOutboxTable;
}

export type ConsentRow = Selectable<ConsentTable>;
export type NewConsent = Insertable<ConsentTable>;
export type ConsentUpdate = Updateable<ConsentTable>;

export type QrNonceRow = Selectable<QrNonceTable>;
export type NewQrNonce = Insertable<QrNonceTable>;

export type TokenRequestRow = Selectable<TokenRequestTable>;
export type NewTokenRequest = Insertable<TokenRequestTable>;

export type PreCheckinRow = Selectable<PreCheckinTable>;
export type KioskSessionRow = Selectable<KioskSessionTable>;
export type PatientRow = Selectable<PatientTable>;
export type GovernanceVersionRow = Selectable<GovernanceVersionTable>;
export type OtpVerificationRow = Selectable<OtpVerificationTable>;
export type IdentityAttemptRow = Selectable<IdentityAttemptTable>;
export type AuditEventRow = Selectable<AuditEventTable>;
export type NewAuditEvent = Insertable<AuditEventTable>;
