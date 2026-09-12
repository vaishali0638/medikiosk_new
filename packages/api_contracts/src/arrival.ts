import { z } from 'zod';
import { TOKEN_REQUEST_STATES } from './enums';
import { maskedIdentitySchema } from './patient';
import { facilityId, isoDateTime, kioskId, uuid } from './primitives';

/** Kiosk presents a scanned QR for validation. */
export const arrivalCheckInRequestSchema = z.object({
  kioskId,
  /** Raw scanned payload. Signature and claims are verified server-side. */
  qrPayload: z.string().min(1).max(4096),
});

export type ArrivalCheckInRequest = z.infer<typeof arrivalCheckInRequestSchema>;

/**
 * Successful validation returns only what the confirmation screen needs.
 * No clinical information crosses this boundary, and none is returned on failure.
 */
export const arrivalCheckInResponseSchema = z.object({
  arrivalId: uuid,
  masked: maskedIdentitySchema,
  hospitalName: z.string(),
  departmentName: z.string(),
  visitTypeLabel: z.string(),
});

export type ArrivalCheckInResponse = z.infer<typeof arrivalCheckInResponseSchema>;

/** Sections a patient can flag as changed since they pre-checked in at home. */
export const CHANGED_SECTIONS = [
  'SYMPTOMS',
  'MEDICINES',
  'ALLERGY_OR_SIDE_EFFECT',
  'NEW_REPORT',
  'NEW_DIAGNOSIS',
  'OTHER',
] as const;

export const arrivalConfirmRequestSchema = z.object({
  /** The patient confirmed the masked identity shown on screen is theirs. */
  identityConfirmed: z.literal(true),
  /** Only the named sections reopen for editing. */
  changedSections: z.array(z.enum(CHANGED_SECTIONS)).default([]),
});

export type ArrivalConfirmRequest = z.infer<typeof arrivalConfirmRequestSchema>;

/**
 * Token request.
 *
 * The idempotency key is derived, not supplied: `<kioskId>-<preCheckinId>`. A repeated
 * request — a retry, a double tap, a network timeout — resolves to the same key and can
 * therefore never produce a second token.
 */
export const tokenRequestSchema = z.object({
  kioskId,
});

export type TokenRequestBody = z.infer<typeof tokenRequestSchema>;

/**
 * Token response.
 *
 * `token` is present only when the HIS actually issued one. A pending or reconciling
 * request returns the state with no token — MediKiosk never invents a placeholder.
 */
export const tokenResponseSchema = z.object({
  state: z.enum(TOKEN_REQUEST_STATES),
  token: z.string().optional(),
  departmentId: facilityId.optional(),
  departmentName: z.string().optional(),
  room: z.string().optional(),
  queueStatus: z.string().optional(),
  issuedAt: isoDateTime.optional(),
});

export type TokenResponse = z.infer<typeof tokenResponseSchema>;

export const arrivalStatusResponseSchema = z.object({
  arrivalId: uuid,
  tokenState: z.enum(TOKEN_REQUEST_STATES),
  token: z.string().optional(),
  /** True when a human must reconcile this with the HIS before anything else happens. */
  reconciliationRequired: z.boolean(),
});

export type ArrivalStatusResponse = z.infer<typeof arrivalStatusResponseSchema>;
