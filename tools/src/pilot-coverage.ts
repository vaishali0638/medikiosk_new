/**
 * The specification's Phase 17 test matrix, mapped to the tests that cover it.
 *
 * The point is not to count tests. It is that every scenario the specification names is
 * either demonstrably covered or explicitly declared uncovered with a reason — so a gap is
 * a decision somebody wrote down, not an omission nobody noticed.
 *
 * A `covers` entry is matched against the test names actually present in the repository. A
 * scenario whose test is renamed or deleted fails here, which is the only way a matrix like
 * this stays true after the first week.
 */

export interface ScenarioCoverage {
  /** The scenario, worded as the specification words it. */
  readonly scenario: string;
  /** Distinctive fragments of test names that cover it. All must be found. */
  readonly covers?: readonly string[];
  /** Why it is not covered. Required when `covers` is absent. */
  readonly gap?: string;
}

export interface ScenarioGroup {
  readonly group: string;
  readonly scenarios: readonly ScenarioCoverage[];
}

export const PILOT_COVERAGE: readonly ScenarioGroup[] = [
  {
    group: 'Workflow',
    scenarios: [
      {
        scenario: 'New registration',
        covers: ['New Registration walks from home to a hospital token'],
      },
      {
        scenario: 'Existing patient',
        covers: ['Existing Patient Check-in confirms a masked record first'],
      },
      {
        scenario: 'Mobile QR arrival',
        covers: ['accepts a valid QR and returns masked details only'],
      },
      {
        scenario: 'Regular follow-up',
        covers: ['keeps unchanged, changed and not-confirmed apart'],
      },
      {
        scenario: 'AYUSH module',
        covers: ['appends the module after the core once it is approved'],
      },
      { scenario: 'Document upload', covers: ['accepts a clean document and records its hash'] },
      {
        scenario: 'Patient review',
        covers: ['shows the patient their own answers with a provenance label on each'],
      },
      { scenario: 'Exit from every screen', covers: ['every active screen offers a way out'] },
    ],
  },
  {
    group: 'QR and security',
    scenarios: [
      { scenario: 'Expired QR', covers: ['refuses an expired QR'] },
      { scenario: 'Replayed QR', covers: ['refuses the same QR a second time'] },
      { scenario: 'Used QR', covers: ['cannot replay a spent arrival handle'] },
      { scenario: 'Wrong hospital', covers: ['refuses a QR presented at another hospital'] },
      { scenario: 'Wrong branch', covers: ['refuses a QR presented at a kiosk in another branch'] },
      { scenario: 'Wrong department', covers: ['refuses a QR issued for another department'] },
      { scenario: 'Forged signature', covers: ['refuses a tampered payload'] },
      {
        scenario: 'Patient mismatch',
        covers: ['refuses when the patient does not confirm the masked details'],
      },
      {
        scenario: 'Duplicate token request',
        covers: ['creates exactly one token under ten concurrent requests'],
      },
    ],
  },
  {
    group: 'Identity',
    scenarios: [
      { scenario: 'Duplicate patients', covers: ['refuses a shared family phone as ambiguous'] },
      { scenario: 'Shared family mobile', covers: ['still refuses a narrowed family phone'] },
      { scenario: 'Wrong DOB', covers: ['refuses a UHID with the wrong date of birth'] },
      {
        scenario: 'No mobile',
        covers: ['registers a patient who has no mobile number of their own'],
      },
      { scenario: 'No ABHA', covers: ['refuses ABHA while the feature is off'] },
      {
        scenario: 'Appointment mismatch',
        covers: ['refuses an appointment QR, which needs a HIS adapter'],
      },
      {
        scenario: 'Multiple visits',
        covers: ['opens a second visit for a patient who has been before'],
      },
    ],
  },
  {
    group: 'HIS and queue',
    scenarios: [
      { scenario: 'Timeout', covers: ['treats a thrown adapter as unknown, not as a failure'] },
      { scenario: 'Retry', covers: ['allows a retry only after a definitive failure'] },
      { scenario: 'Token already issued', covers: ['recovers a token the HIS had already issued'] },
      { scenario: 'Cancelled visit', covers: ['refuses a cancelled pre-check-in'] },
      {
        scenario: 'No-show',
        covers: ['leaves an unattended visit with no token and no encounter'],
      },
      {
        scenario: 'Reconciliation',
        covers: ['resolves a parked request once the hospital can be reached'],
      },
      {
        scenario: 'Printer failure',
        covers: ['says the token is still valid when printing fails'],
      },
    ],
  },
  {
    group: 'Clinical safety',
    scenarios: [
      {
        scenario: 'Allergy uncertainty',
        covers: ['surfaces a non-committal answer as not confirmed'],
      },
      { scenario: 'OCR dose uncertainty', covers: ['flags low-confidence fields individually'] },
      {
        scenario: 'AI malformed output',
        covers: ['refuses malformed generator output rather than rendering it'],
      },
      {
        scenario: 'Unsupported language fallback',
        covers: ['refuses rather than falling back to another language'],
      },
      {
        scenario: 'Sensitive question refusal',
        covers: ['records a refusal to answer as an answer, not as a gap'],
      },
      {
        scenario: 'Internal red-flag status',
        gap:
          'Red-flag rules are not built. The specification puts them behind FEATURE_RED_FLAGS ' +
          'and requires hospital-approved deterministic rules, which is Phase 0 content nobody ' +
          'has authored. The flag defaults off and no rule exists to test.',
      },
    ],
  },
  {
    group: 'Accessibility',
    scenarios: [
      {
        scenario: 'Large text mode',
        covers: ['large text applies the token scale', 'large text scales the label'],
      },
      {
        scenario: 'High-contrast mode',
        covers: ['body text on the page background meets the contrast floor'],
      },
      { scenario: 'Touch-only users', covers: ['meets the 48dp minimum touch target'] },
      {
        scenario: 'Low-literacy users',
        covers: ['renders the text label even when an icon is supplied'],
      },
      {
        scenario: 'Elderly users',
        covers: [
          'keeps the heading and primary action visible when content overflows',
          'body text meets the minimum readable size for elderly patients',
        ],
      },
      {
        scenario: 'Voice-assisted users',
        covers: [
          'distinguishes an approved recording from device text-to-speech',
          'says so plainly when audio is unavailable',
        ],
      },
      {
        scenario: 'Noisy environment',
        gap:
          'Needs voice intake and real hardware in a real OPD. ASR is not built, and a ' +
          'microphone array in a corridor cannot be simulated in a widget test.',
      },
      {
        scenario: 'Caregiver operation',
        gap:
          'A relative operating the kiosk for a patient is indistinguishable from the patient ' +
          'doing it, by design — the system never asks who is holding the screen. Whether that ' +
          'is right is a question for observation in the pilot, not a test.',
      },
    ],
  },
  {
    group: 'Forbidden-option scan',
    scenarios: [
      {
        scenario: 'Automated scan over kiosk UI and content',
        covers: [
          'flags every banned phrase',
          'finds no violation anywhere in the current repository',
        ],
      },
    ],
  },
];
