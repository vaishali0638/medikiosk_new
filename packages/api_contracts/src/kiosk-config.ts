import { z } from 'zod';
import { AYUSH_SYSTEMS } from './enums';
import { contentVersion, facilityId, languageTag } from './primitives';

export const languageOptionSchema = z.object({
  tag: languageTag,
  /** Endonym, e.g. `हिन्दी`. Shown in the language's own script. */
  label: z.string().min(1),
  /** False until a clinical translation reviewer has approved the content. */
  clinicallyReviewed: z.boolean(),
  audioAvailable: z.boolean(),
});

export const departmentOptionSchema = z.object({
  departmentId: facilityId,
  name: z.string().min(1),
  ayushSystem: z.enum(AYUSH_SYSTEMS).optional(),
});

/**
 * Feature flags as the kiosk sees them.
 *
 * A disabled feature must not render at all — not greyed out, not hidden behind a
 * message. The kiosk builds its UI from this list, so an unfinished capability cannot
 * leak into a patient's view.
 */
export const featureFlagsSchema = z.object({
  abha: z.boolean(),
  aiSummary: z.boolean(),
  ocr: z.boolean(),
  redFlags: z.boolean(),
  voiceIntake: z.boolean(),
});

export type FeatureFlags = z.infer<typeof featureFlagsSchema>;

export const kioskConfigResponseSchema = z.object({
  hospitalId: facilityId,
  hospitalName: z.string(),
  branchId: facilityId,
  kioskId: z.string(),
  languages: z.array(languageOptionSchema).min(1),
  departments: z.array(departmentOptionSchema),
  /** Only systems this hospital has configured and approved. */
  ayushSystems: z.array(z.enum(AYUSH_SYSTEMS)),
  features: featureFlagsSchema,
  /** Published governance content versions this kiosk should be running. */
  contentVersions: z.object({
    questionnaire: contentVersion,
    translations: contentVersion,
    consentNotice: z.string().min(1),
  }),
  /** Session timing, so a hospital can tune it without shipping a new build. */
  session: z.object({
    inactivityWarningSeconds: z.number().int().positive(),
    inactivityWipeSeconds: z.number().int().positive(),
  }),
});

export type KioskConfigResponse = z.infer<typeof kioskConfigResponseSchema>;
