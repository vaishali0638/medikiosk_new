import { z } from 'zod';
import { CONSENT_DATA_CATEGORIES } from './enums';
import { languageTag } from './primitives';

/**
 * A published consent notice.
 *
 * This is governed content: authored, reviewed and approved through the governance
 * registry, published per language, and versioned. It is deliberately NOT a string table
 * in the client. The exact wording a patient agreed to must be reconstructable years
 * later from `version` alone, which is impossible if a developer can edit it in a build.
 */
export const consentNoticeSchema = z.object({
  /** Version the patient is agreeing to. Stored on the consent artefact. */
  version: z.string().min(1),
  language: languageTag,
  /** Short heading, e.g. "Privacy and consent". */
  title: z.string().min(1),
  /** The bulleted summary shown on the consent screen. */
  collectedItems: z.array(z.string().min(1)).min(1),
  /** Plain-language statement of purpose. */
  purpose: z.string().min(1),
  /** Machine-readable categories, mirrored onto the consent artefact. */
  dataCategories: z.array(z.enum(CONSENT_DATA_CATEGORIES)).min(1),
  /** The complete notice, shown behind "Read full notice". */
  fullText: z.string().min(1),
  /**
   * Whether a recorded audio reading exists for this language. When false the kiosk
   * falls back to device text-to-speech and says so, rather than silently reading
   * approved wording in a synthetic voice the reviewer never heard.
   */
  audioAvailable: z.boolean(),
  /** Named clinical/legal approval, so the screen can be traced to who signed it off. */
  approvedBy: z.array(z.string()).min(1),
  effectiveFrom: z.string(),
});

export type ConsentNotice = z.infer<typeof consentNoticeSchema>;

/**
 * A kiosk asking for a notice in a language with no published version gets this, and
 * must not proceed. Falling back to another language would ask a patient to agree to
 * wording they cannot read.
 */
export const consentNoticeUnavailableSchema = z.object({
  available: z.literal(false),
  language: languageTag,
});
