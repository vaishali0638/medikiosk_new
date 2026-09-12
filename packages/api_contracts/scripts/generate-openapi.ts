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
import { consentResponseSchema, createConsentRequestSchema } from '../src/consent';
import { patientMatchRequestSchema, patientMatchResponseSchema } from '../src/patient';
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
  PatientMatchRequest: patientMatchRequestSchema,
  PatientMatchResponse: patientMatchResponseSchema,
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
    method: 'post',
    path: '/consents',
    summary: 'Record a purpose-bound consent decision.',
    tag: 'consent',
    status: 'not-implemented',
    phase: '4',
    requestSchema: 'CreateConsentRequest',
    responseSchema: 'Consent',
  },
  {
    method: 'post',
    path: '/patients/match',
    summary: 'Resolve a patient identity. Name alone is never sufficient.',
    tag: 'identity',
    status: 'not-implemented',
    phase: '5',
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
    path: '/arrival/{id}/token',
    summary: 'Request a final token from the hospital HIS. Never issues one independently.',
    tag: 'arrival',
    status: 'not-implemented',
    phase: '7',
    requestSchema: 'TokenRequest',
    responseSchema: 'TokenResponse',
    idempotent: true,
  },
  {
    method: 'get',
    path: '/arrival/{id}/status',
    summary: 'Poll a token outcome and reconciliation state.',
    tag: 'arrival',
    status: 'not-implemented',
    phase: '7',
    responseSchema: 'ArrivalStatusResponse',
  },
  {
    method: 'post',
    path: '/documents',
    summary: 'Upload an original document and queue asynchronous processing.',
    tag: 'documents',
    status: 'not-implemented',
    phase: '10',
  },
  {
    method: 'post',
    path: '/followups/{id}/delta',
    summary: 'Submit follow-up changes against the last clinician-verified visit.',
    tag: 'followup',
    status: 'not-implemented',
    phase: '12',
  },
  {
    method: 'get',
    path: '/doctor/worklist',
    summary: 'Authorised clinician worklist.',
    tag: 'doctor',
    status: 'not-implemented',
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

  if (spec.tag === 'kiosk' || spec.tag === 'arrival') {
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
