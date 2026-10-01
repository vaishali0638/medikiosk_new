import { HttpException, HttpStatus } from '@nestjs/common';
import { apiError, PATIENT_MESSAGES, type ErrorCode } from '@medikiosk/api-contracts';

/** Maps a domain error code to an HTTP status. */
const STATUS_BY_CODE: Readonly<Record<ErrorCode, HttpStatus>> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  CONSENT_REQUIRED: HttpStatus.FORBIDDEN,
  CONSENT_DECLINED: HttpStatus.FORBIDDEN,
  CONSENT_EXPIRED: HttpStatus.FORBIDDEN,
  IDENTITY_NOT_CONFIRMED: HttpStatus.UNPROCESSABLE_ENTITY,
  IDENTITY_AMBIGUOUS: HttpStatus.UNPROCESSABLE_ENTITY,
  // Every QR failure is 422 with one identical body. Using distinct statuses would let a
  // holder of a stolen code distinguish "expired" from "wrong hospital" and probe.
  QR_INVALID: HttpStatus.UNPROCESSABLE_ENTITY,
  QR_EXPIRED: HttpStatus.UNPROCESSABLE_ENTITY,
  QR_ALREADY_USED: HttpStatus.UNPROCESSABLE_ENTITY,
  QR_WRONG_FACILITY: HttpStatus.UNPROCESSABLE_ENTITY,
  PRE_CHECKIN_NOT_SUBMITTED: HttpStatus.UNPROCESSABLE_ENTITY,
  PRE_CHECKIN_CANCELLED: HttpStatus.UNPROCESSABLE_ENTITY,
  TOKEN_ALREADY_ISSUED: HttpStatus.CONFLICT,
  TOKEN_REQUEST_FAILED: HttpStatus.SERVICE_UNAVAILABLE,
  TOKEN_RECONCILIATION_REQUIRED: HttpStatus.SERVICE_UNAVAILABLE,
  HIS_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  OTP_SERVICE_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  SESSION_EXPIRED: HttpStatus.GONE,
  NOT_AUTHENTICATED: HttpStatus.UNAUTHORIZED,
  // 403, and deliberately the same status and body whether the record does not exist or
  // exists in another department. A clinician probing ids must not be able to tell which.
  NOT_AUTHORISED: HttpStatus.FORBIDDEN,
  INVALID_STATE_TRANSITION: HttpStatus.CONFLICT,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

/**
 * A failure with a code for operators and a neutral message for patients.
 *
 * The two are deliberately separate. `internalDetail` is for logs and audit only and must
 * never reach a response body: a kiosk stands in a public corridor, and an error screen
 * that explains *why* a lookup failed leaks information about who is registered.
 */
export class DomainError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    readonly correlationId: string,
    readonly internalDetail?: string,
  ) {
    super(apiError(code, correlationId), STATUS_BY_CODE[code]);
    this.name = 'DomainError';
  }

  /** The text a patient may see. Never includes internalDetail. */
  get patientMessage(): string {
    return PATIENT_MESSAGES[this.code];
  }
}

export { STATUS_BY_CODE };

/**
 * A failure whose reason may be shown to the caller.
 *
 * The default everywhere else is that `internalDetail` never leaves the server: a kiosk
 * stands in a public corridor and an error that explains itself is an oracle for probing
 * stolen codes and unknown ids.
 *
 * Staff surfaces are the exception, and only some of them. A governance reviewer refused a
 * release is the person who has to fix it, and the gate deliberately returns every problem
 * at once so they can be fixed in one pass — withholding that made the console refuse a
 * release and leave the reviewer guessing whether they needed a second approver, a
 * qualification, or a different version number.
 *
 * A distinct class rather than a flag, so every place that discloses a reason can be found
 * by searching for the type.
 */
export class StaffFacingError extends DomainError {
  constructor(code: ErrorCode, correlationId: string, detail: string) {
    super(code, correlationId, detail);
    this.name = 'StaffFacingError';
  }
}
