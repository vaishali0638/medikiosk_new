import { z } from 'zod';
import { IDENTITY_MATCH_STRENGTHS, IDENTITY_METHODS, PATIENT_IDENTIFIER_TYPES } from './enums';
import { facilityId, isoDate, mobileNumber, uhid, uuid } from './primitives';

export const sexSchema = z.enum(['FEMALE', 'MALE', 'OTHER', 'PREFER_NOT_TO_SAY']);

export const demographicsSchema = z.object({
  name: z.string().min(1).max(200),
  dateOfBirth: isoDate.optional(),
  /** Age in years, accepted when a patient does not know their date of birth. */
  ageYears: z.number().int().min(0).max(130).optional(),
  sex: sexSchema,
  mobile: mobileNumber,
  email: z.string().email().optional(),
  address: z.string().max(500).optional(),
});

export type Demographics = z.infer<typeof demographicsSchema>;

/**
 * Masked identity shown on a kiosk confirmation screen.
 *
 * The kiosk stands in a public corridor, so it never renders a full name or mobile
 * number: enough to let the right patient recognise themselves, not enough for a
 * bystander to harvest.
 */
export const maskedIdentitySchema = z.object({
  /** e.g. `R*** K****` */
  maskedName: z.string(),
  /** e.g. `******3210` */
  maskedMobile: z.string(),
});

export type MaskedIdentity = z.infer<typeof maskedIdentitySchema>;

export const patientIdentifierSchema = z.object({
  type: z.enum(PATIENT_IDENTIFIER_TYPES),
  value: z.string().min(1).max(128),
  /** The facility that issued this identifier; UHIDs are only unique within one. */
  issuedBy: facilityId,
});

/**
 * Identity match request.
 *
 * There is deliberately no name-only variant: name alone can never resolve a patient,
 * because the cost of returning the wrong person's record is a clinical-safety incident.
 */
export const patientMatchRequestSchema = z.union([
  z.object({ method: z.literal('UHID_AND_ENCOUNTER'), uhid, hospitalId: facilityId }),
  z.object({ method: z.literal('APPOINTMENT_QR'), qrPayload: z.string().min(1) }),
  z.object({ method: z.literal('MOBILE_OTP'), verificationId: uuid }),
  z.object({ method: z.literal('ABHA_VERIFIED'), abhaToken: z.string().min(1) }),
]);

export type PatientMatchRequest = z.infer<typeof patientMatchRequestSchema>;

/**
 * Identity match result.
 *
 * `candidateCount > 1` never returns a patient. Duplicates are routed to a controlled
 * error state and resolved by hospital staff — the system does not guess, and does not
 * merge records automatically.
 */
export const patientMatchResponseSchema = z.object({
  strength: z.enum(IDENTITY_MATCH_STRENGTHS),
  method: z.enum(IDENTITY_METHODS),
  candidateCount: z.number().int().min(0),
  /** Present only when exactly one candidate matched at STRONG or better. */
  patientId: uuid.optional(),
  /** Present only alongside `patientId`. Masked, never full identity. */
  masked: maskedIdentitySchema.optional(),
});

export type PatientMatchResponse = z.infer<typeof patientMatchResponseSchema>;
