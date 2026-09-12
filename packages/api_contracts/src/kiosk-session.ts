import { z } from 'zod';
import { KIOSK_SESSION_STATES } from './enums';
import { isoDateTime, kioskId, languageTag, uuid } from './primitives';

/**
 * Why a kiosk session ended.
 *
 * All four outcomes wipe the session. The distinction exists for monitoring — a rising
 * TIMEOUT or ERROR rate is an operational signal — not to vary the wipe.
 */
export const SESSION_END_REASONS = ['EXIT', 'TIMEOUT', 'COMPLETED', 'ERROR'] as const;
export type SessionEndReason = (typeof SESSION_END_REASONS)[number];

export const startKioskSessionRequestSchema = z.object({
  kioskId,
});

export const kioskSessionSchema = z.object({
  sessionId: uuid,
  state: z.enum(KIOSK_SESSION_STATES),
  startedAt: isoDateTime,
  /** When the client should show the timeout warning if the patient has not acted. */
  warnAt: isoDateTime,
  /** When the client must wipe and return home. */
  expiresAt: isoDateTime,
});

export type KioskSession = z.infer<typeof kioskSessionSchema>;

export const selectLanguageRequestSchema = z.object({
  language: languageTag,
});

/**
 * Session termination.
 *
 * `wiped` is an attestation from the client that it actually cleared UI state, temporary
 * files, camera and audio buffers and local caches. The server refuses to close a session
 * without it and records the refusal, so a wipe that silently failed becomes visible in
 * monitoring rather than leaving one patient's data on screen for the next.
 */
export const endKioskSessionRequestSchema = z.object({
  reason: z.enum(SESSION_END_REASONS),
  wiped: z.literal(true),
});

export type EndKioskSessionRequest = z.infer<typeof endKioskSessionRequestSchema>;

export const endKioskSessionResponseSchema = z.object({
  sessionId: uuid,
  state: z.enum(KIOSK_SESSION_STATES),
  endedAt: isoDateTime,
});
