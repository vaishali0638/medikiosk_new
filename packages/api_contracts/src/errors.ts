import { z } from 'zod';

/**
 * Structured error codes.
 *
 * Two separate concerns are encoded here on purpose: `code` is for logs, metrics and
 * runbooks, while `patientMessage` is the neutral text a patient may see. A failure
 * must never disclose clinical information or why an identity match failed — an
 * attacker holding a stolen QR learns nothing beyond "this cannot be used".
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'CONSENT_REQUIRED',
  'CONSENT_DECLINED',
  'CONSENT_EXPIRED',
  'IDENTITY_NOT_CONFIRMED',
  'IDENTITY_AMBIGUOUS',
  'QR_INVALID',
  'QR_EXPIRED',
  'QR_ALREADY_USED',
  'QR_WRONG_FACILITY',
  'PRE_CHECKIN_NOT_SUBMITTED',
  'PRE_CHECKIN_CANCELLED',
  'TOKEN_ALREADY_ISSUED',
  'TOKEN_REQUEST_FAILED',
  'TOKEN_RECONCILIATION_REQUIRED',
  'HIS_UNAVAILABLE',
  'RATE_LIMITED',
  'SESSION_EXPIRED',
  'INVALID_STATE_TRANSITION',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Neutral patient-facing text for each code.
 *
 * Every QR failure maps to one identical message. Distinguishing "expired" from
 * "already used" from "wrong hospital" on screen would turn the kiosk into an oracle
 * for probing stolen codes, so the distinction lives only in the audit log.
 */
const QR_NEUTRAL_MESSAGE =
  'This QR cannot be used. It is expired, already used, invalid or not for this hospital.';

export const PATIENT_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: 'Some information could not be accepted. Please check and try again.',
  CONSENT_REQUIRED: 'Consent is needed before this step can continue.',
  CONSENT_DECLINED: 'This MediKiosk clinical intake will not continue.',
  CONSENT_EXPIRED: 'Consent is needed before this step can continue.',
  IDENTITY_NOT_CONFIRMED: 'We could not confirm your details at this kiosk.',
  IDENTITY_AMBIGUOUS: 'We could not confirm your details at this kiosk.',
  QR_INVALID: QR_NEUTRAL_MESSAGE,
  QR_EXPIRED: QR_NEUTRAL_MESSAGE,
  QR_ALREADY_USED: QR_NEUTRAL_MESSAGE,
  QR_WRONG_FACILITY: QR_NEUTRAL_MESSAGE,
  PRE_CHECKIN_NOT_SUBMITTED: QR_NEUTRAL_MESSAGE,
  PRE_CHECKIN_CANCELLED: QR_NEUTRAL_MESSAGE,
  TOKEN_ALREADY_ISSUED: 'A token has already been issued for this visit.',
  TOKEN_REQUEST_FAILED: 'The hospital system could not be reached. Please speak to the counter.',
  TOKEN_RECONCILIATION_REQUIRED:
    'The hospital system could not be reached. Please speak to the counter.',
  HIS_UNAVAILABLE: 'The hospital system could not be reached. Please speak to the counter.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  SESSION_EXPIRED: 'This session has ended. Please start again.',
  INVALID_STATE_TRANSITION: 'This step cannot be completed right now.',
  INTERNAL_ERROR: 'Something went wrong. Please start again.',
};

export const apiErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  /** Neutral, localisable text safe to render to a patient. */
  patientMessage: z.string(),
  /** Correlation id for support; carries no patient data. */
  correlationId: z.string().uuid(),
  /** Field-level detail. Populated only for VALIDATION_FAILED. */
  details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

/** Builds a patient-safe error body. Never accepts free-form patient-facing text. */
export function apiError(
  code: ErrorCode,
  correlationId: string,
  details?: ApiError['details'],
): ApiError {
  return {
    code,
    patientMessage: PATIENT_MESSAGES[code],
    correlationId,
    ...(details ? { details } : {}),
  };
}
