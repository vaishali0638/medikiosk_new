/**
 * Generates docs/api/openapi.json from the Zod contracts.
 *
 * The Zod schemas are the single source of truth: the API validates with them, the
 * clients are typed from them, and this document is derived from them. Hand-maintaining
 * a parallel OpenAPI file would let the published contract drift from what the server
 * actually accepts.
 *
 * Endpoints that are specified but not yet built are listed with an `x-status` of
 * `not-implemented`, so the document describes the intended surface honestly rather than
 * implying working endpoints.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  API_CONTRACT_VERSION,
  CORRELATION_ID_HEADER,
  IDEMPOTENCY_KEY_HEADER,
  KIOSK_DEVICE_HEADER,
} from '../src/index';
import { apiErrorSchema } from '../src/errors';
import {
  consentResponseSchema,
  createConsentRequestSchema,
  kioskConsentDecisionSchema,
  revokeConsentRequestSchema,
} from '../src/consent';
import { consentNoticeSchema } from '../src/consent-notice';
import { patientMatchRequestSchema, patientMatchResponseSchema } from '../src/patient';
import {
  confirmIdentityResponseSchema,
  confirmIdentitySchema,
  registerPatientSchema,
  requestOtpResponseSchema,
  requestOtpSchema,
  resolveIdentityResponseSchema,
  resolveIdentitySchema,
  verifyOtpResponseSchema,
  verifyOtpSchema,
} from '../src/identity';
import {
  createPreCheckinRequestSchema,
  issueQrResponseSchema,
  preCheckinSchema,
} from '../src/precheckin';
import {
  arrivalCheckInRequestSchema,
  arrivalCheckInResponseSchema,
  arrivalConfirmRequestSchema,
  arrivalStatusResponseSchema,
  tokenRequestSchema,
  tokenResponseSchema,
} from '../src/arrival';
import { kioskConfigResponseSchema } from '../src/kiosk-config';
import {
  endKioskSessionRequestSchema,
  endKioskSessionResponseSchema,
  kioskSessionSchema,
  selectLanguageRequestSchema,
  startKioskSessionRequestSchema,
} from '../src/kiosk-session';

const schemas: Record<string, ZodTypeAny> = {
  ApiError: apiErrorSchema,
  CreateConsentRequest: createConsentRequestSchema,
  Consent: consentResponseSchema,
  ConsentNotice: consentNoticeSchema,
  KioskConsentDecision: kioskConsentDecisionSchema,
  RevokeConsentRequest: revokeConsentRequestSchema,
  PatientMatchRequest: patientMatchRequestSchema,
  PatientMatchResponse: patientMatchResponseSchema,
  RequestOtpRequest: requestOtpSchema,
  RequestOtpResponse: requestOtpResponseSchema,
  VerifyOtpRequest: verifyOtpSchema,
  VerifyOtpResponse: verifyOtpResponseSchema,
  ResolveIdentityRequest: resolveIdentitySchema,
  ResolveIdentityResponse: resolveIdentityResponseSchema,
  ConfirmIdentityRequest: confirmIdentitySchema,
  ConfirmIdentityResponse: confirmIdentityResponseSchema,
  RegisterPatientRequest: registerPatientSchema,
  CreatePreCheckinRequest: createPreCheckinRequestSchema,
  PreCheckin: preCheckinSchema,
  IssueQrResponse: issueQrResponseSchema,
  ArrivalCheckInRequest: arrivalCheckInRequestSchema,
  ArrivalCheckInResponse: arrivalCheckInResponseSchema,
  ArrivalConfirmRequest: arrivalConfirmRequestSchema,
  TokenRequest: tokenRequestSchema,
  TokenResponse: tokenResponseSchema,
  ArrivalStatusResponse: arrivalStatusResponseSchema,
  KioskConfigResponse: kioskConfigResponseSchema,
  StartKioskSessionRequest: startKioskSessionRequestSchema,
  KioskSession: kioskSessionSchema,
  SelectLanguageRequest: selectLanguageRequestSchema,
  EndKioskSessionRequest: endKioskSessionRequestSchema,
  EndKioskSessionResponse: endKioskSessionResponseSchema,
};

type Status = 'implemented' | 'not-implemented';

interface EndpointSpec {
  readonly method: 'get' | 'post';
  readonly path: string;
  readonly summary: string;
  readonly tag: string;
  readonly status: Status;
  readonly phase: string;
  readonly requestSchema?: string;
  readonly responseSchema?: string;
  readonly idempotent?: boolean;
}

/** Every /v1 endpoint in the specification, with its honest build status. */
const endpoints: readonly EndpointSpec[] = [
  {
    method: 'get',
    path: '/kiosk/config',
    summary: 'Languages, departments, AYUSH systems, feature flags and content versions.',
    tag: 'kiosk',
    status: 'implemented',
    phase: '3',
    responseSchema: 'KioskConfigResponse',
  },
  {
    method: 'post',
    path: '/kiosk/sessions',
    summary: 'Start a kiosk session.',
    tag: 'kiosk',
    status: 'implemented',
    phase: '3',
    responseSchema: 'KioskSession',
  },
  {
    method: 'post',
    path: '/kiosk/sessions/{id}/activity',
    summary: 'Record patient activity and reset the inactivity window.',
    tag: 'kiosk',
    status: 'implemented',
    phase: '3',
    responseSchema: 'KioskSession',
  },
  {
    method: 'post',
    path: '/kiosk/sessions/{id}/language',
    summary: 'Record the selected language. Only clinically reviewed languages are accepted.',
    tag: 'kiosk',
    status: 'implemented',
    phase: '3',
    requestSchema: 'SelectLanguageRequest',
    responseSchema: 'KioskSession',
  },
  {
    method: 'post',
    path: '/kiosk/sessions/{id}/end',
    summary: 'End a session. Requires the client to attest that it wiped its state.',
    tag: 'kiosk',
    status: 'implemented',
    phase: '3',
    requestSchema: 'EndKioskSessionRequest',
    responseSchema: 'EndKioskSessionResponse',
  },
  {
    method: 'get',
    path: '/consents/notice',
    summary:
      'The published consent notice for a language. No cross-language fallback: asking a ' +
      'patient to agree to wording they cannot read is not consent.',
    tag: 'consent',
    status: 'implemented',
    phase: '4',
    responseSchema: 'ConsentNotice',
  },
  {
    method: 'post',
    path: '/consents',
    summary:
      'Record a consent decision. Purpose, categories and notice version are taken from ' +
      'the published notice server-side, not from the client.',
    tag: 'consent',
    status: 'implemented',
    phase: '4',
    requestSchema: 'KioskConsentDecision',
    responseSchema: 'Consent',
  },
  {
    method: 'get',
    path: '/consents/{id}',
    summary: "Read a consent artefact back. Scoped to the calling kiosk's hospital.",
    tag: 'consent',
    status: 'implemented',
    phase: '4',
    responseSchema: 'Consent',
  },
  {
    method: 'post',
    path: '/consents/{id}/revoke',
    summary: 'Withdraw a granted consent. Recorded, never deleted.',
    tag: 'consent',
    status: 'implemented',
    phase: '4',
    requestSchema: 'RevokeConsentRequest',
    responseSchema: 'Consent',
  },
  {
    method: 'post',
    path: '/identity/otp',
    summary:
      'Send a one-time code. The response is identical whether or not the number is ' +
      'registered, so the kiosk cannot be used to test which numbers are patients here.',
    tag: 'identity',
    status: 'implemented',
    phase: '5',
    requestSchema: 'RequestOtpRequest',
    responseSchema: 'RequestOtpResponse',
  },
  {
    method: 'post',
    path: '/identity/otp/verify',
    summary: 'Verify a one-time code. Attempts are limited, then the code locks.',
    tag: 'identity',
    status: 'implemented',
    phase: '5',
    requestSchema: 'VerifyOtpRequest',
    responseSchema: 'VerifyOtpResponse',
  },
  {
    method: 'post',
    path: '/identity/resolve',
    summary:
      'Resolve a patient. Returns masked details only, and refuses anything that is not ' +
      'exactly one confident match. Name alone is not expressible in the contract.',
    tag: 'identity',
    status: 'implemented',
    phase: '5',
    requestSchema: 'ResolveIdentityRequest',
    responseSchema: 'ResolveIdentityResponse',
  },
  {
    method: 'post',
    path: '/identity/confirm',
    summary: 'The patient confirms the masked details shown are their own.',
    tag: 'identity',
    status: 'implemented',
    phase: '5',
    requestSchema: 'ConfirmIdentityRequest',
    responseSchema: 'ConfirmIdentityResponse',
  },
  {
    method: 'post',
    path: '/identity/register',
    summary: 'Register a new patient by promoting the provisional record consent created.',
    tag: 'identity',
    status: 'implemented',
    phase: '5',
    requestSchema: 'RegisterPatientRequest',
  },
  {
    method: 'post',
    path: '/patients/match',
    summary: 'Resolve a patient identity. Name alone is never sufficient.',
    tag: 'identity',
    status: 'not-implemented',
    phase: '5 (superseded by /identity/resolve)',
    requestSchema: 'PatientMatchRequest',
    responseSchema: 'PatientMatchResponse',
  },
  {
    method: 'post',
    path: '/precheckins',
    summary: 'Create a mobile pre-check-in.',
    tag: 'precheckin',
    status: 'not-implemented',
    phase: '6',
    requestSchema: 'CreatePreCheckinRequest',
    responseSchema: 'PreCheckin',
    idempotent: true,
  },
  {
    method: 'post',
    path: '/precheckins/{id}/submit',
    summary: 'Submit a reviewed intake.',
    tag: 'precheckin',
    status: 'not-implemented',
    phase: '6',
    responseSchema: 'PreCheckin',
    idempotent: true,
  },
  {
    method: 'post',
    path: '/precheckins/{id}/qr',
    summary: 'Issue a signed, short-lived, single-use QR reference. Carries no medical data.',
    tag: 'precheckin',
    status: 'not-implemented',
    phase: '6',
    responseSchema: 'IssueQrResponse',
  },
  {
    method: 'post',
    path: '/arrival/check-in',
    summary: 'Validate a scanned QR at a kiosk. Discloses nothing clinical on failure.',
    tag: 'arrival',
    status: 'not-implemented',
    phase: '6',
    requestSchema: 'ArrivalCheckInRequest',
    responseSchema: 'ArrivalCheckInResponse',
  },
  {
    method: 'post',
    path: '/arrival/{id}/confirm',
    summary: 'Confirm masked identity and declare what has changed since pre-check-in.',
    tag: 'arrival',
    status: 'not-implemented',
    phase: '6',
    requestSchema: 'ArrivalConfirmRequest',
  },
  {
    method: 'post',
    path: '/arrival/{handle}/token',
    summary:
      'Request the hospital token. The HIS issues it; MediKiosk never invents one, and ' +
      'never issues a second for the same visit. An uncertain outcome is parked for a human.',
    tag: 'arrival',
    status: 'implemented',
    phase: '7',
    requestSchema: 'TokenRequest',
    responseSchema: 'TokenResponse',
    idempotent: true,
  },
  {
    method: 'get',
    path: '/arrival/{handle}/status',
    summary: 'Poll the recorded outcome. Never contacts the HIS.',
    tag: 'arrival',
    status: 'implemented',
    phase: '7',
    responseSchema: 'ArrivalStatusResponse',
  },
  {
    method: 'get',
    path: '/ops/reconciliation',
    summary: 'Token requests awaiting human reconciliation. Exposes no patient data.',
    tag: 'ops',
    status: 'implemented',
    phase: '7',
  },
  {
    method: 'post',
    path: '/ops/reconciliation/sweep',
    summary: 'Re-poll the HIS for unresolved requests. Only ever asks; never requests a token.',
    tag: 'ops',
    status: 'implemented',
    phase: '7',
  },
  {
    method: 'get',
    path: '/intakes/ayush-systems',
    summary:
      'AYUSH systems this hospital can run an intake for: an enabled department AND a ' +
      'published, four-role-approved module.',
    tag: 'intake',
    status: 'implemented',
    phase: '9',
  },
  {
    method: 'get',
    path: '/intakes/{preCheckinId}/next',
    summary:
      'The next approved question, chosen by deterministic rules over the answers so far. ' +
      'No model participates in choosing the clinical interview.',
    tag: 'intake',
    status: 'implemented',
    phase: '8',
  },
  {
    method: 'post',
    path: '/intakes/{preCheckinId}/answers',
    summary:
      'Record an answer as a new revision, with its questionnaire version, source and ' +
      'modality. Answers append; they never overwrite.',
    tag: 'intake',
    status: 'implemented',
    phase: '8',
  },
  {
    method: 'get',
    path: '/intakes/{preCheckinId}/answers',
    summary: 'Structured answers for the review screen, each with its provenance.',
    tag: 'intake',
    status: 'implemented',
    phase: '8',
  },
  {
    method: 'post',
    path: '/precheckins/{preCheckinId}/documents',
    summary:
      'Upload an original document as base64. Validated, malware-scanned and encrypted ' +
      'before any row is written; extraction is queued and never blocks the visit.',
    tag: 'documents',
    status: 'implemented',
    phase: '10',
  },
  {
    method: 'get',
    path: '/precheckins/{preCheckinId}/documents',
    summary:
      'Documents attached to a visit, with extraction state. Carries neither the ' +
      'rejection reason nor any confidence score.',
    tag: 'documents',
    status: 'implemented',
    phase: '10',
  },
  {
    method: 'get',
    path: '/documents/{documentId}/original',
    summary:
      'The original bytes, decrypted and re-hashed on the way out; a mismatch is refused ' +
      'rather than served.',
    tag: 'documents',
    status: 'implemented',
    phase: '10',
  },
  {
    method: 'get',
    path: '/documents/{documentId}/extraction',
    summary:
      'Extraction candidates for a document. Every field is labelled for verification ' +
      'and none of it is a clinical record until a clinician confirms it.',
    tag: 'documents',
    status: 'implemented',
    phase: '10',
  },
  {
    method: 'post',
    path: '/kiosk/sessions/{id}/visit',
    summary:
      'Open the visit for a walk-in patient whose identity is confirmed. Idempotent per ' +
      'session; the patient is taken from the session, never from the request body.',
    tag: 'kiosk',
    status: 'implemented',
    phase: '11',
  },
  {
    method: 'get',
    path: '/intakes/{preCheckinId}/question/{questionId}',
    summary:
      'One question, for reopening a single answer from the review screen. Served only ' +
      'if the branching still makes it applicable.',
    tag: 'intake',
    status: 'implemented',
    phase: '11',
  },
  {
    method: 'get',
    path: '/precheckins/{preCheckinId}/review',
    summary:
      'What the patient checks before submitting: their own answers, each with a ' +
      'provenance label. Carries nothing derived — no narrative, no draft.',
    tag: 'summary',
    status: 'implemented',
    phase: '11',
  },
  {
    method: 'post',
    path: '/precheckins/{preCheckinId}/submit-intake',
    summary:
      'Records the patient’s confirmed review and produces the clinician draft. ' +
      'Refuses without confirmation; idempotent per visit.',
    tag: 'summary',
    status: 'implemented',
    phase: '11',
    idempotent: true,
  },
  {
    method: 'get',
    path: '/precheckins/{preCheckinId}/draft',
    summary:
      'The pre-consultation draft, always labelled AI-ASSISTED DRAFT — NOT VERIFIED. ' +
      'Every statement carries its own provenance; nothing in it is a clinical record.',
    tag: 'summary',
    status: 'implemented',
    phase: '11',
  },
  {
    method: 'get',
    path: '/precheckins/{preCheckinId}/previous-visit',
    summary:
      'The last clinician-verified visit, with the record itself so a clinician can ' +
      'inspect what is carried forward. Never an AI draft.',
    tag: 'followup',
    status: 'implemented',
    phase: '12',
  },
  {
    method: 'post',
    path: '/precheckins/{preCheckinId}/follow-up',
    summary:
      'Record what changed since the last verified visit. Replaces any previous delta, ' +
      'so a patient may go back and correct it.',
    tag: 'followup',
    status: 'implemented',
    phase: '12',
  },
  {
    method: 'get',
    path: '/precheckins/{preCheckinId}/delta',
    summary:
      'The follow-up as a clinician reads it: unchanged, changed and not-confirmed kept ' +
      'apart, never one merged list.',
    tag: 'followup',
    status: 'implemented',
    phase: '12',
  },
  {
    method: 'post',
    path: '/doctor/session',
    summary:
      'Exchange a staff identity-provider credential for a session. MediKiosk holds no ' +
      'staff password and cannot create an account.',
    tag: 'doctor',
    status: 'implemented',
    phase: '13',
  },
  {
    method: 'get',
    path: '/doctor/encounters/{encounterId}',
    summary:
      'The case: draft with its unverified banner, documents with confidence and ' +
      'short-lived signed links, and the follow-up delta. Every view is audited.',
    tag: 'doctor',
    status: 'implemented',
    phase: '13',
  },
  {
    method: 'post',
    path: '/doctor/encounters/{encounterId}/confirm',
    summary:
      'The clinician confirms the record. Writes a new CLINICIAN-VERIFIED summary rather ' +
      'than overwriting the draft.',
    tag: 'doctor',
    status: 'implemented',
    phase: '13',
  },
  {
    method: 'post',
    path: '/doctor/encounters/{encounterId}/export',
    summary:
      'Export a confirmed record to the EMR. Refuses an unconfirmed one; idempotent per ' +
      'encounter; an uncertain outcome is reconciled, never blindly retried.',
    tag: 'doctor',
    status: 'implemented',
    phase: '13',
    idempotent: true,
  },
  {
    method: 'get',
    path: '/doctor/worklist',
    summary:
      'Authorised clinician worklist, scoped to their department in the query. Names ' +
      'masked; searchable by token or UHID only.',
    tag: 'doctor',
    status: 'implemented',
    phase: '13',
  },
  {
    method: 'get',
    path: '/intakes/{id}/summary',
    summary: 'Source-labelled pre-consultation draft.',
    tag: 'doctor',
    status: 'not-implemented',
    phase: '13',
  },
  {
    method: 'post',
    path: '/intakes/{id}/confirm',
    summary: 'Clinician confirmation. Required before any clinical export.',
    tag: 'doctor',
    status: 'not-implemented',
    phase: '13',
  },
  {
    method: 'post',
    path: '/encounters/{id}/export',
    summary: 'Export a clinician-verified record to the HIS/EMR.',
    tag: 'doctor',
    status: 'not-implemented',
    phase: '13',
  },
  {
    method: 'post',
    path: '/governance/releases',
    summary:
      'Create a draft. Content is schema-validated at authoring, and the rollback pointer ' +
      'is derived from whatever is live.',
    tag: 'governance',
    status: 'implemented',
    phase: '14',
  },
  {
    method: 'post',
    path: '/governance/releases/{releaseId}/transition',
    summary:
      'Move a release along its lifecycle. The approval gate is checked on the ' +
      'IN_REVIEW → APPROVED edge; publication is unreachable without it.',
    tag: 'governance',
    status: 'implemented',
    phase: '14',
  },
  {
    method: 'get',
    path: '/governance/releases/{releaseId}/history',
    summary: 'Every state change a release went through, with who made it.',
    tag: 'governance',
    status: 'implemented',
    phase: '14',
  },
  {
    method: 'get',
    path: '/governance/unversioned',
    summary:
      'Required content this hospital has nothing published for, per language. The exit ' +
      'criterion "no live content lacks a version" as a query rather than a promise.',
    tag: 'governance',
    status: 'implemented',
    phase: '14',
  },
  {
    method: 'post',
    path: '/governance/releases/{id}/approve',
    summary: 'Approve, publish or roll back governed clinical content.',
    tag: 'governance',
    status: 'not-implemented',
    phase: '14',
  },
];

const ref = (name: string): { $ref: string } => ({ $ref: `#/components/schemas/${name}` });

const errorResponse = (description: string): unknown => ({
  description,
  content: { 'application/json': { schema: ref('ApiError') } },
});

function buildOperation(spec: EndpointSpec): unknown {
  const parameters: unknown[] = [
    {
      name: CORRELATION_ID_HEADER,
      in: 'header',
      required: true,
      description: 'UUID correlating one patient journey across every service.',
      schema: { type: 'string', format: 'uuid' },
    },
  ];

  if (spec.path.includes('{id}')) {
    parameters.push({
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    });
  }

  if (
    spec.tag === 'kiosk' ||
    spec.tag === 'arrival' ||
    spec.tag === 'consent' ||
    spec.tag === 'identity' ||
    spec.tag === 'intake'
  ) {
    parameters.push({
      name: KIOSK_DEVICE_HEADER,
      in: 'header',
      required: true,
      description:
        'Kiosk device code, e.g. `MK-OPD-03`. Identification, not authentication — ' +
        'Phase 15 adds mutual-TLS device certificates.',
      schema: { type: 'string' },
    });
  }

  if (spec.idempotent) {
    parameters.push({
      name: IDEMPOTENCY_KEY_HEADER,
      in: 'header',
      required: true,
      description:
        'Collapses retries onto one operation. For tokens: `<kioskCode>-<preCheckinId>`.',
      schema: { type: 'string', minLength: 8, maxLength: 200 },
    });
  }

  return {
    summary: spec.summary,
    tags: [spec.tag],
    'x-status': spec.status,
    'x-phase': spec.phase,
    parameters,
    ...(spec.requestSchema
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref(spec.requestSchema) } },
          },
        }
      : {}),
    responses: {
      '200': spec.responseSchema
        ? {
            description: 'Success',
            content: { 'application/json': { schema: ref(spec.responseSchema) } },
          }
        : { description: 'Success' },
      '400': errorResponse('Validation failed.'),
      '403': errorResponse('Consent missing, expired or declined.'),
      '409': errorResponse('Conflicting state, such as a token already issued.'),
      '422': errorResponse('Neutral rejection. Carries no clinical detail.'),
      '503': errorResponse('The hospital HIS could not be reached.'),
    },
  };
}

const paths: Record<string, Record<string, unknown>> = {};
for (const spec of endpoints) {
  const fullPath = `/v1${spec.path}`;
  paths[fullPath] = { ...(paths[fullPath] ?? {}), [spec.method]: buildOperation(spec) };
}

const document = {
  openapi: '3.1.0',
  info: {
    title: 'MediKiosk Core API',
    version: API_CONTRACT_VERSION,
    description:
      'Patient intake, consent, pre-check-in, QR validation and HIS token requests.\n\n' +
      'Operations carry `x-status`. `not-implemented` means the contract is fixed but the ' +
      'endpoint is not built yet — it is listed so the intended surface is visible, not to ' +
      'imply it works. The hospital HIS remains the sole authority for a final patient token.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local development' }],
  components: {
    schemas: Object.fromEntries(
      Object.entries(schemas).map(([name, schema]) => [
        name,
        zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' }),
      ]),
    ),
  },
  paths,
};

const outPath = resolve(__dirname, '../../../docs/api/openapi.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

const implemented = endpoints.filter((e) => e.status === 'implemented').length;
process.stdout.write(
  `openapi -> ${outPath} (${endpoints.length} endpoints, ${implemented} implemented, ` +
    `${Object.keys(schemas).length} schemas)\n`,
);
