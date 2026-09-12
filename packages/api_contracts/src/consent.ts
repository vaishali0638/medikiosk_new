import { z } from 'zod';
import { CONSENT_CAPTURE_METHODS, CONSENT_DATA_CATEGORIES, CONSENT_STATES } from './enums';
import { facilityId, isoDateTime, kioskId, languageTag, uuid } from './primitives';

/**
 * Consent artefact.
 *
 * Consent is purpose-bound and category-bound: a consent granted for OPD intake does not
 * authorise any other processing, and every category of data collected must be named here.
 * The notice version is stored so it is always possible to reconstruct exactly what the
 * patient was shown.
 */
export const consentSchema = z.object({
  consentId: uuid,
  /** A provisional id is used before a patient record exists. */
  patientId: uuid,
  hospitalId: facilityId,
  purpose: z.literal('OPD clinical intake and consultation'),
  dataCategories: z.array(z.enum(CONSENT_DATA_CATEGORIES)).min(1),
  language: languageTag,
  noticeVersion: z.string().min(1),
  status: z.enum(CONSENT_STATES),
  capturedAt: isoDateTime,
  validUntil: isoDateTime,
  captureMethod: z.enum(CONSENT_CAPTURE_METHODS),
  kioskId: kioskId.optional(),
});

export type Consent = z.infer<typeof consentSchema>;

export const createConsentRequestSchema = consentSchema
  .pick({
    patientId: true,
    hospitalId: true,
    dataCategories: true,
    language: true,
    noticeVersion: true,
    captureMethod: true,
    kioskId: true,
  })
  .extend({
    /** Explicit grant or decline. There is no implied consent. */
    decision: z.enum(['GRANTED', 'DECLINED']),
  });

export type CreateConsentRequest = z.infer<typeof createConsentRequestSchema>;

export const consentResponseSchema = consentSchema;
export type ConsentResponse = z.infer<typeof consentResponseSchema>;
