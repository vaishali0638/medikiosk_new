/**
 * Patient-channel API client.
 *
 * Mirrors the kiosk client's two hard rules: decode responses as UTF-8 explicitly rather
 * than trusting a charset header (consent notices are Devanagari), and never compose
 * patient-facing error text locally — the server's neutral message is the one to show.
 */

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const HOSPITAL_HEADER = 'x-hospital';

const API_BASE_URL = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';
const HOSPITAL_CODE = process.env['NEXT_PUBLIC_HOSPITAL_CODE'] ?? 'HOSP-001';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly patientMessage: string,
    readonly correlationId?: string,
    readonly status?: number,
  ) {
    super(`${code} (${status ?? 'network'})`);
    this.name = 'ApiError';
  }

  get isNetworkFailure(): boolean {
    return this.code === 'NETWORK_UNAVAILABLE';
  }
}

function correlationId(): string {
  return crypto.randomUUID();
}

async function send<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const cid = correlationId();
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        [CORRELATION_ID_HEADER]: cid,
        [HOSPITAL_HEADER]: HOSPITAL_CODE,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(
      'NETWORK_UNAVAILABLE',
      'We cannot reach the hospital right now. Please try again in a moment.',
      cid,
    );
  }

  // Decode the bytes, not response.text(), for the same reason the kiosk client does:
  // a missing charset must not turn Devanagari into mojibake.
  const buffer = await response.arrayBuffer();
  const text = new TextDecoder('utf-8').decode(buffer);

  let parsed: unknown = {};
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiError('INTERNAL_ERROR', 'Something went wrong. Please start again.', cid);
    }
  }

  if (!response.ok) {
    const error = parsed as { code?: string; patientMessage?: string; correlationId?: string };
    throw new ApiError(
      error.code ?? 'INTERNAL_ERROR',
      error.patientMessage ?? 'Something went wrong. Please start again.',
      error.correlationId ?? cid,
      response.status,
    );
  }

  return parsed as T;
}

export interface HospitalInfo {
  hospitalId: string;
  hospitalName: string;
  languages: string[];
}

export interface ConsentNotice {
  version: string;
  language: string;
  title: string;
  collectedItems: string[];
  purpose: string;
  fullText: string;
  approvedBy: string[];
}

export interface ConsentResult {
  consentId: string;
  patientId: string;
  status: string;
  noticeVersion: string;
}

export interface PreCheckinResult {
  preCheckinId: string;
  state: string;
}

export interface QrResult {
  preCheckinId: string;
  payload: string;
  expiresAt: string;
}

export const api = {
  hospital: (): Promise<HospitalInfo> => send('GET', '/v1/patient/hospital'),

  notice: (language: string): Promise<ConsentNotice> =>
    send('GET', `/v1/patient/consents/notice?language=${encodeURIComponent(language)}`),

  consent: (language: string, decision: 'GRANTED' | 'DECLINED'): Promise<ConsentResult> =>
    send('POST', '/v1/patient/consents', { language, decision }),

  createPreCheckin: (payload: unknown): Promise<PreCheckinResult> =>
    send('POST', '/v1/precheckins', payload),

  submit: (id: string): Promise<{ state: string }> => send('POST', `/v1/precheckins/${id}/submit`),

  issueQr: (id: string): Promise<QrResult> => send('POST', `/v1/precheckins/${id}/qr`),
};
