'use client';

/**
 * The state a pre-check-in accumulates across pages.
 *
 * Held in sessionStorage, which dies with the tab. Nothing clinical is kept here — only
 * the ids needed to continue, plus the demographics the patient is part-way through
 * typing. A patient who closes the tab starts again rather than leaving a half-finished
 * record on a shared phone.
 */
export interface Journey {
  language?: string;
  hospitalName?: string;
  consentId?: string;
  noticeVersion?: string;
  name?: string;
  sex?: string;
  dateOfBirth?: string;
  mobile?: string;
  departmentId?: string;
  visitType?: 'NEW_COMPLAINT' | 'REGULAR_FOLLOW_UP';
  preCheckinId?: string;
}

const KEY = 'medikiosk.journey';

export function readJourney(): Journey {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.sessionStorage.getItem(KEY) ?? '{}') as Journey;
  } catch {
    return {};
  }
}

export function updateJourney(patch: Journey): Journey {
  const next = { ...readJourney(), ...patch };
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A private-mode browser with storage disabled still works; the patient just cannot
    // navigate backwards without re-entering. Failing the whole flow would be worse.
  }
  return next;
}

export function clearJourney(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
