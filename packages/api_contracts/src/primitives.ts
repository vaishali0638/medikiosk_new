import { z } from 'zod';

/** Internal identifiers are UUIDs everywhere; hospital identifiers are separate. */
export const uuid = z.string().uuid();

/** ISO-8601 timestamp with timezone. */
export const isoDateTime = z.string().datetime({ offset: true });

/** ISO-8601 calendar date. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/**
 * Indian mobile number, digits only, without country code.
 * Rejected values never reach a log — see redact() in the core API.
 */
export const mobileNumber = z
  .string()
  .regex(/^[6-9]\d{9}$/, 'expected a 10-digit Indian mobile number');

/** Hospital-assigned unique health identifier. Format varies per hospital. */
export const uhid = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9/-]+$/);

/** Hospital, branch and department identifiers are opaque strings from hospital config. */
export const facilityId = z.string().min(1).max(64);

/** Kiosk device identifier, e.g. `MK-OPD-03`. */
export const kioskId = z.string().min(1).max(64);

/** BCP-47 language tag restricted to the hospital's approved set at runtime. */
export const languageTag = z.string().min(2).max(16);

/** Semantic version of a governed content release. */
export const contentVersion = z.string().regex(/^\d+\.\d+\.\d+$/);

/** SHA-256 hex digest of an original document. */
export const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * Idempotency key for submissions and token requests.
 * Token requests use `<kioskId>-<preCheckinId>`.
 */
export const idempotencyKey = z.string().min(8).max(200);

/** A confidence score attached to any machine-derived value. */
export const confidence = z.number().min(0).max(1);
