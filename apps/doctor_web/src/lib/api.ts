/**
 * Clinician API client.
 *
 * Two differences from the patient client, both deliberate.
 *
 * The session token is held in memory and in `sessionStorage`, never in a cookie. A cookie
 * would be sent automatically with every request the page makes, which is what makes CSRF
 * possible; a bearer token the code has to attach cannot be attached by someone else's form.
 * `sessionStorage` rather than `localStorage` so closing the tab ends the session — a
 * shared consulting-room machine should not have a doctor still signed in an hour later.
 *
 * And errors are surfaced with their code. A patient gets one neutral sentence; a clinician
 * needs to know whether they were refused because the record is in another department or
 * because their session expired, since the two need different actions from them.
 */

const API_BASE_URL = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';
const TOKEN_KEY = 'medikiosk.doctor.token';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get needsSignIn(): boolean {
    return this.code === 'NOT_AUTHENTICATED' || this.status === 401;
  }

  get needsBreakGlass(): boolean {
    return this.code === 'NOT_AUTHORISED';
  }
}

export function storeToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function readToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

async function send<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const token = readToken();
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-correlation-id': crypto.randomUUID(),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('NETWORK_UNAVAILABLE', 'Cannot reach the hospital system.');
  }

  const text = new TextDecoder('utf-8').decode(await response.arrayBuffer());
  let parsed: unknown = {};
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiError('INTERNAL_ERROR', 'The server returned something unreadable.');
    }
  }

  if (!response.ok) {
    const error = parsed as { code?: string; patientMessage?: string };
    throw new ApiError(
      error.code ?? 'INTERNAL_ERROR',
      error.patientMessage ?? 'Something went wrong.',
      response.status,
    );
  }

  return parsed as T;
}

export const apiBaseUrl = API_BASE_URL;

export interface WorklistEntry {
  encounterId: string;
  token: string | null;
  maskedName: string;
  departmentName: string;
  tokenIssuedAt: string | null;
  verified: boolean;
  hasDraft: boolean;
  documentCount: number;
}

export interface DraftStatement {
  text: string;
  provenance: string;
  sourceRef: string;
}

export interface DraftSection {
  key: string;
  heading: string;
  statements: DraftStatement[];
}

export interface CaseDocument {
  documentId: string;
  documentType: string;
  state: string;
  reviewState: string | null;
  overallConfidence: number | null;
  fields: unknown;
  link: { url: string; expiresAt: string } | null;
}

export interface DeltaItem {
  kind: string;
  label: string;
  changeKind: string;
  detail: Record<string, unknown>;
  source: string;
}

export interface CaseView {
  encounterId: string;
  verified: boolean;
  verifiedAt: string | null;
  draft: {
    summaryId: string;
    banner: string;
    provenance: string;
    generator: string;
    sections: DraftSection[];
    narrative: string;
  } | null;
  followUp: {
    previousVerifiedAt: string;
    previousDepartment: string;
    unchanged: DeltaItem[];
    changed: DeltaItem[];
    notConfirmed: DeltaItem[];
  } | null;
  documents: CaseDocument[];
}

export const api = {
  signIn: (credential: string): Promise<{ token: string; displayName: string; role: string }> =>
    send('POST', '/v1/doctor/session', { credential }),

  signOut: (): Promise<unknown> => send('POST', '/v1/doctor/session/end'),

  worklist: (search?: string): Promise<{ entries: WorklistEntry[] }> =>
    send('GET', `/v1/doctor/worklist${search ? `?search=${encodeURIComponent(search)}` : ''}`),

  case: (encounterId: string, breakGlassReason?: string): Promise<CaseView> =>
    send(
      'GET',
      `/v1/doctor/encounters/${encounterId}${
        breakGlassReason ? `?breakGlassReason=${encodeURIComponent(breakGlassReason)}` : ''
      }`,
    ),

  confirm: (encounterId: string, record: unknown, breakGlassReason?: string) =>
    send<{ summaryId: string; verifiedAt: string; provenance: string }>(
      'POST',
      `/v1/doctor/encounters/${encounterId}/confirm`,
      { record, ...(breakGlassReason ? { breakGlassReason } : {}) },
    ),

  export: (encounterId: string) =>
    send<{ state: string; hisRecordRef: string | null }>(
      'POST',
      `/v1/doctor/encounters/${encounterId}/export`,
    ),
};
