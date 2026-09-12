/**
 * Forbidden kiosk options.
 *
 * The build prompt bans these from the patient-facing UI. They are not merely style
 * preferences — each one either invites a workaround around hospital authority (a token
 * the HIS did not issue, a QR the backend did not sign) or advertises a support channel
 * that the deployed workflow does not actually provide. Shipping one would be a clinical
 * -safety and governance failure, so this is enforced in CI rather than by review.
 */
export const FORBIDDEN_OPTIONS: readonly string[] = [
  'Staff Help',
  'Get Staff Help',
  'Urgent Help',
  'I need urgent help',
  'Generate New QR',
  'Enter hospital reference',
  'Register without phone',
  'Enter token',
  'Approved ABHA Flow',
];

/** Directories whose contents are patient- or clinician-facing UI. */
export const SCANNED_ROOTS: readonly string[] = [
  'apps/kiosk_flutter/lib',
  'apps/kiosk_flutter/assets',
  'apps/patient_pwa/src',
  'apps/patient_pwa/messages',
  'apps/doctor_web/src',
  'apps/governance_web/src',
  'packages/terminology/src',
  'packages/questionnaire_schema/src',
];

/** File types that can put words in front of a patient. */
export const SCANNED_EXTENSIONS: readonly string[] = [
  '.dart',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.arb',
  '.json',
  '.yaml',
  '.yml',
  '.html',
];
