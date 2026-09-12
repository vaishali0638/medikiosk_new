import { z } from 'zod';
import { AYUSH_SYSTEMS, PRE_CHECKIN_STATES, VISIT_TYPES } from './enums';
import { demographicsSchema } from './patient';
import { facilityId, isoDateTime, uuid } from './primitives';

export const visitContextSchema = z.object({
  hospitalId: facilityId,
  branchId: facilityId,
  departmentId: facilityId,
  ayushSystem: z.enum(AYUSH_SYSTEMS).optional(),
  visitType: z.enum(VISIT_TYPES),
  /** Hospital appointment reference, when the patient has one. */
  appointmentRef: z.string().max(128).optional(),
  visitWindowStart: isoDateTime,
  visitWindowEnd: isoDateTime,
});

export type VisitContext = z.infer<typeof visitContextSchema>;

export const createPreCheckinRequestSchema = z.object({
  consentId: uuid,
  visit: visitContextSchema,
  demographics: demographicsSchema,
});

export type CreatePreCheckinRequest = z.infer<typeof createPreCheckinRequestSchema>;

export const preCheckinSchema = z.object({
  preCheckinId: uuid,
  patientId: uuid,
  consentId: uuid,
  visit: visitContextSchema,
  state: z.enum(PRE_CHECKIN_STATES),
  createdAt: isoDateTime,
  submittedAt: isoDateTime.optional(),
});

export type PreCheckin = z.infer<typeof preCheckinSchema>;

/**
 * The QR handed to the patient's phone.
 *
 * `payload` is a signed *reference* — no medical data is ever placed inside a QR code,
 * because the code is displayed on a phone screen in a public waiting area and may be
 * photographed by anyone standing nearby.
 */
export const issueQrResponseSchema = z.object({
  preCheckinId: uuid,
  /** Compact signed token (JWS). Opaque to the client. */
  payload: z.string().min(1),
  expiresAt: isoDateTime,
});

export type IssueQrResponse = z.infer<typeof issueQrResponseSchema>;

/**
 * Decoded QR claims. Validated server-side on every scan; a client must never trust
 * these without a signature check.
 */
export const qrClaimsSchema = z.object({
  preCheckinId: uuid,
  hospitalId: facilityId,
  branchId: facilityId,
  departmentId: facilityId,
  visitWindowStart: isoDateTime,
  visitWindowEnd: isoDateTime,
  /** One-time nonce; consumed atomically on first successful scan. */
  nonce: uuid,
  expiresAt: isoDateTime,
});

export type QrClaims = z.infer<typeof qrClaimsSchema>;
