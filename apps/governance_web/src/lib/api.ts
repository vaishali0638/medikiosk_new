/**
 * Governance console API client.
 *
 * Same session handling as the clinician dashboard — a bearer token in `sessionStorage`,
 * never a cookie — because both are staff surfaces on shared machines and the reasoning is
 * identical. The endpoints differ entirely: nothing here touches a patient record.
 */

const API_BASE_URL = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3000';
const TOKEN_KEY = 'medikiosk.governance.token';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly message: string,
    readonly status?: number,
    /**
     * The staff-facing explanation, where the endpoint provides one.
     *
     * Most of this API withholds it — a kiosk in a public corridor must not be told why a
     * lookup failed. The governance endpoints are the exception: the reviewer is the
     * person who has to act on the reason, and the gate returns every problem at once so
     * they can be fixed in one pass.
     */
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get needsSignIn(): boolean {
    return this.code === 'NOT_AUTHENTICATED' || this.status === 401;
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
    const error = parsed as { code?: string; patientMessage?: string; detail?: string };
    throw new ApiError(
      error.code ?? 'INTERNAL_ERROR',
      error.detail ?? error.patientMessage ?? 'Something went wrong.',
      response.status,
      error.detail,
    );
  }
  return parsed as T;
}

export interface Approval {
  role: string;
  by: string;
  qualification?: string;
  at: string;
}

export interface Release {
  id: string;
  contentKind: string;
  contentKey: string;
  semver: string;
  state: string;
  approvals: Approval[];
  publishedAt: string | null;
  publishedBy: string | null;
  canaryKioskCodes: string[];
  rollbackReason: string | null;
  createdAt: string;
}

export interface Transition {
  from_state: string | null;
  to_state: string;
  actor_user_id: string;
  note: string | null;
  occurred_at: string;
}

export interface Missing {
  kind: string;
  key: string;
  why: string;
}

export const api = {
  signIn: (credential: string): Promise<{ token: string; displayName: string; role: string }> =>
    send('POST', '/v1/doctor/session', { credential }),

  signOut: (): Promise<unknown> => send('POST', '/v1/doctor/session/end'),

  releases: (): Promise<{ releases: Release[] }> => send('GET', '/v1/governance/releases'),

  unversioned: (): Promise<{ missing: Missing[] }> => send('GET', '/v1/governance/unversioned'),

  createDraft: (payload: {
    contentKind: string;
    contentKey: string;
    semver: string;
    payload: unknown;
  }): Promise<{ releaseId: string; state: string }> =>
    send('POST', '/v1/governance/releases', payload),

  approve: (releaseId: string, approval: Approval): Promise<unknown> =>
    send('POST', `/v1/governance/releases/${releaseId}/approvals`, approval),

  transition: (
    releaseId: string,
    body: {
      to: string;
      note?: string;
      canaryKioskCodes?: string[];
      rollbackReason?: string;
    },
  ): Promise<{ state: string }> =>
    send('POST', `/v1/governance/releases/${releaseId}/transition`, body),

  history: (releaseId: string): Promise<{ transitions: Transition[] }> =>
    send('GET', `/v1/governance/releases/${releaseId}/history`),
};

/** The lifecycle, so the console can only offer moves the machine permits. */
export const NEXT_STATES: Readonly<Record<string, readonly string[]>> = {
  DRAFT: ['IN_REVIEW', 'RETIRED'],
  IN_REVIEW: ['DRAFT', 'APPROVED', 'RETIRED'],
  APPROVED: ['CANARY', 'PUBLISHED', 'RETIRED'],
  CANARY: ['PUBLISHED', 'ROLLED_BACK'],
  PUBLISHED: ['ROLLED_BACK', 'RETIRED'],
  ROLLED_BACK: [],
  RETIRED: [],
};

export const APPROVAL_ROLES = [
  'AUTHOR',
  'CLINICAL_REVIEWER',
  'TRANSLATION_REVIEWER',
  'SAFETY_REVIEWER',
] as const;
