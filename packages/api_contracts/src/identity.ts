import { z } from 'zod';
import { IDENTITY_MATCH_STRENGTHS, IDENTITY_METHODS, OTP_PURPOSES } from './enums';
import { isoDate, isoDateTime, mobileNumber, uhid, uuid } from './primitives';
import { maskedIdentitySchema } from './patient';

export const requestOtpSchema = z.object({
  mobile: mobileNumber,
  purpose: z.enum(OTP_PURPOSES),
});

/**
 * Response to an OTP request.
 *
 * Deliberately identical whether or not the number is registered. A response that
 * differed would turn the kiosk into a way to test which mobile numbers belong to
 * patients of this hospital.
 */
export const requestOtpResponseSchema = z.object({
  verificationId: uuid,
  /** Masked echo so the patient can check they typed their own number. */
  maskedMobile: z.string(),
  expiresAt: isoDateTime,
  /** How many verification attempts remain before a new code is required. */
  attemptsAllowed: z.number().int().positive(),
});

export const verifyOtpSchema = z.object({
  verificationId: uuid,
  code: z.string().regex(/^\d{6}$/),
});

export const verifyOtpResponseSchema = z.object({
  verificationId: uuid,
  verified: z.literal(true),
});

/**
 * Identity resolution request.
 *
 * There is no name-only variant, and there never will be. Name alone cannot resolve a
 * patient: the cost of returning the wrong person's record is a clinical-safety incident,
 * and names in this setting are frequently shared.
 */
export const resolveIdentitySchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('UHID_AND_ENCOUNTER'),
    uhid,
    /** Confirms the patient is who they say. Required — UHIDs are printed on paper. */
    dateOfBirth: isoDate.optional(),
    yearOfBirth: z.number().int().min(1900).max(2100).optional(),
  }),
  z.object({
    method: z.literal('APPOINTMENT_QR'),
    qrPayload: z.string().min(1).max(4096),
  }),
  z.object({
    method: z.literal('MOBILE_OTP'),
    verificationId: uuid,
    /**
     * Narrows a shared family phone. Mobile plus OTP alone is only a MODERATE match —
     * it proves possession of a handset, not identity.
     */
    dateOfBirth: isoDate.optional(),
    yearOfBirth: z.number().int().min(1900).max(2100).optional(),
  }),
  z.object({
    method: z.literal('ABHA_VERIFIED'),
    abhaToken: z.string().min(1),
  }),
]);

export type ResolveIdentityRequest = z.infer<typeof resolveIdentitySchema>;

/** Why an identity could not be resolved. Structured for logs; never shown to a patient. */
export const IDENTITY_OUTCOMES = [
  'MATCHED',
  'NOT_FOUND',
  'AMBIGUOUS',
  'OTP_NOT_VERIFIED',
  'OTP_ALREADY_USED',
  'INSUFFICIENT_STRENGTH',
  'METHOD_DISABLED',
] as const;
export type IdentityOutcome = (typeof IDENTITY_OUTCOMES)[number];

/**
 * A resolved identity, awaiting the patient's own confirmation.
 *
 * Carries masked identity only. No clinical information crosses this boundary, and none
 * is returned on an unresolved or ambiguous match — the kiosk must never become a way to
 * read a stranger's history by guessing a UHID.
 */
export const resolveIdentityResponseSchema = z.object({
  /** Short-lived handle the patient confirms against. Not the patient id. */
  candidateId: uuid,
  method: z.enum(IDENTITY_METHODS),
  strength: z.enum(IDENTITY_MATCH_STRENGTHS),
  masked: maskedIdentitySchema,
  /** Masked UHID, when the hospital record has one. */
  maskedUhid: z.string().optional(),
  expiresAt: isoDateTime,
});

export type ResolveIdentityResponse = z.infer<typeof resolveIdentityResponseSchema>;

/** The patient confirming the masked details shown to them are their own. */
export const confirmIdentitySchema = z.object({
  candidateId: uuid,
  isMe: z.literal(true),
});

export const confirmIdentityResponseSchema = z.object({
  patientId: uuid,
  strength: z.enum(IDENTITY_MATCH_STRENGTHS),
});

/** New-patient registration, after the mobile has been verified. */
export const registerPatientSchema = z.object({
  verificationId: uuid,
  name: z.string().min(1).max(200),
  sex: z.enum(['FEMALE', 'MALE', 'OTHER', 'PREFER_NOT_TO_SAY']),
  dateOfBirth: isoDate.optional(),
  ageYears: z.number().int().min(0).max(130).optional(),
  email: z.string().email().optional(),
  address: z.string().max(500).optional(),
});

export type RegisterPatientRequest = z.infer<typeof registerPatientSchema>;
