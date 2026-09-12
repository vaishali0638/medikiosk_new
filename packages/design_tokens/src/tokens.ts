/**
 * Canonical MediKiosk design tokens.
 *
 * This file is the single source of truth for the theme. The Dart theme
 * (apps/kiosk_flutter/lib/theme/design_tokens.dart) and the CSS custom properties
 * (packages/design_tokens/dist/tokens.css) are GENERATED from here — never edit
 * those by hand, run `npm run tokens:build`.
 *
 * Colour semantics are mandated by the build prompt and are a safety requirement,
 * not a stylistic one:
 *   blue   -> navigation and information
 *   orange -> primary actions and selected states
 *   red    -> INTERNAL/system alert status only, never a patient-facing diagnosis
 */

export const colors = {
  /** Page background. Always explicit — never rely on an inherited ground. */
  background: '#FFFFFF',
  /** Primary hospital blue: navigation, headers, informational surfaces. */
  primaryBlue: '#1565C0',
  /** Darker blue for pressed states and high-emphasis headers. */
  darkBlue: '#0D47A1',
  /** Action orange: the single primary action on a screen, and selected states. */
  actionOrange: '#F57C00',
  /** Tinted orange background for selected chips/cards. */
  lightOrange: '#FFF3E0',
  /** Success confirmations (token issued, submission accepted). */
  success: '#2E7D32',
  /** Default body text. */
  neutralText: '#263238',
  /** Secondary/supporting text. Meets 4.5:1 on white. */
  mutedText: '#546E7A',
  /** Hairlines, dividers, input borders. */
  border: '#D9E2F3',
  /**
   * Internal alert status ONLY (system/ops surfaces, red-flag internal events).
   * MUST NOT be used on a patient-facing screen to imply a diagnosis.
   */
  internalAlert: '#C62828',
  /** Neutral, non-alarming surface for patient-facing error states. */
  neutralErrorSurface: '#ECEFF1',
} as const;

export type ColorToken = keyof typeof colors;

/** Spacing scale in logical pixels / dp. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  /** Inputs and small controls. */
  sm: 8,
  /** Cards and panels. */
  md: 16,
  /** Large rounded primary buttons — the kiosk house style. */
  lg: 24,
  pill: 999,
} as const;

/**
 * Accessibility floors. These are enforced by widget tests, not just convention:
 * kiosk users are frequently elderly or low-literacy.
 */
export const a11y = {
  /** Minimum touch target in dp. */
  minTouchTargetDp: 48,
  /** Minimum body text size in sp/dp. */
  minBodyTextSp: 18,
  /** Multiplier applied when "Large Text" is enabled. */
  largeTextScale: 1.35,
  /** Minimum contrast ratio for text against its background. */
  minContrastRatio: 4.5,
} as const;

export const typography = {
  /** Screen title, e.g. "MediKiosk". */
  display: { sizeSp: 44, weight: 700, lineHeight: 1.15 },
  /** Section heading / question text. */
  heading: { sizeSp: 30, weight: 600, lineHeight: 1.25 },
  /** Button and option labels. */
  action: { sizeSp: 24, weight: 600, lineHeight: 1.3 },
  /** Body copy. */
  body: { sizeSp: 20, weight: 400, lineHeight: 1.45 },
  /** Supporting/secondary copy and provenance labels. */
  caption: { sizeSp: 16, weight: 400, lineHeight: 1.4 },
} as const;

export type TypographyToken = keyof typeof typography;

/** Kiosk session timing, in seconds. Overridable per-hospital via kiosk config. */
export const timing = {
  /** Idle time before the timeout warning appears. */
  inactivityWarningSec: 90,
  /** Further idle time after the warning before the session is wiped. */
  inactivityWipeSec: 30,
  /** Target for a normal screen transition (performance budget, ms). */
  screenTransitionBudgetMs: 500,
} as const;
