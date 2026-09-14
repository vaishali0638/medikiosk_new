/**
 * The specification's production-readiness checklist, as something that evaluates itself.
 *
 * The instruction is "Do not claim production readiness until…", so the useful artifact is
 * not a document that asserts readiness — it is one that refuses to, and says exactly what
 * is missing. A checklist a human ticks by hand becomes a checklist a human ticks by habit.
 *
 * Three kinds of item:
 *
 *   `automated` — provable here, and proven by a check that runs.
 *   `deployment` — true of the code, but only real once a hospital has configured it. The
 *                  repository can say "the mechanism exists"; it cannot say "it is switched
 *                  on at this hospital".
 *   `organisational` — nothing in a repository can satisfy it. A practitioner signing off
 *                  clinical content, a privacy review, a completed pilot.
 *
 * Anything not `automated` blocks readiness, permanently and by design.
 */

export type ItemKind = 'automated' | 'deployment' | 'organisational';

export interface ChecklistItem {
  /** The criterion, worded as the specification words it. */
  readonly criterion: string;
  readonly kind: ItemKind;
  /** What makes it true, or what stops it being true. */
  readonly evidence: string;
  /** For automated items: whether the repository currently satisfies it. */
  readonly satisfied?: boolean;
}

export const PRODUCTION_CHECKLIST: readonly ChecklistItem[] = [
  {
    criterion: 'All required workflow tests pass',
    kind: 'automated',
    satisfied: true,
    evidence:
      'Phase 17 maps all 45 named scenarios to tests, checked against the names present. ' +
      'Three are declared gaps with reasons.',
  },
  {
    criterion: 'All security tests pass',
    kind: 'automated',
    satisfied: true,
    evidence:
      '41 adversarial tests in security.int-spec.ts: bypass, escalation, injection, forgery.',
  },
  {
    criterion: 'No forbidden option appears',
    kind: 'automated',
    satisfied: true,
    evidence: 'scan:forbidden runs in CI over Dart, TypeScript, Kotlin and XML sources.',
  },
  {
    criterion: 'Kiosk session wipe works',
    kind: 'automated',
    satisfied: true,
    evidence:
      'Wipe on exit, timeout, completion and error, with an attestation the database ' +
      'requires for a client-ended session — and a metric counting the server-expired ' +
      'sessions that carry none.',
  },
  {
    criterion: 'Mobile QR validation works',
    kind: 'automated',
    satisfied: true,
    evidence:
      'Expiry, replay, single-use nonce, wrong hospital, wrong branch, wrong department ' +
      'and forged signature, each refused with one identical body.',
  },
  {
    criterion: 'Final token is HIS-authoritative',
    kind: 'deployment',
    evidence:
      'MediKiosk never invents a token, proven under concurrency. But the only adapter ' +
      'that ships is a sandbox: a real HIS integration is hospital-specific work that has ' +
      'not been written, so today the "hospital" issuing tokens is a stub.',
  },
  {
    criterion: 'Reconciliation works',
    kind: 'automated',
    satisfied: true,
    evidence:
      'Uncertain outcomes park rather than retry, a sweep resolves what the HIS can answer, ' +
      'and the rest is listed for an operator.',
  },
  {
    criterion: 'Patient review is mandatory',
    kind: 'automated',
    satisfied: true,
    evidence:
      'review_confirmed is a NOT NULL CHECK (review_confirmed), so an unconfirmed ' +
      'submission row cannot exist even if the application check were deleted.',
  },
  {
    criterion: 'Doctor confirmation is mandatory before clinical export',
    kind: 'automated',
    satisfied: true,
    evidence:
      'Export reads encounter.verified_at, which cannot be set without a named clinician ' +
      'and a CLINICIAN-VERIFIED summary.',
  },
  {
    criterion: 'Original documents are preserved',
    kind: 'automated',
    satisfied: true,
    evidence:
      'AES-256-GCM at rest, SHA-256 over the plaintext re-checked on read, and a refusal ' +
      'to serve rather than serve something altered.',
  },
  {
    criterion: 'AI/OCR provenance is visible',
    kind: 'automated',
    satisfied: true,
    evidence:
      'A label on every statement, an unverified banner on every draft, and a database ' +
      'constraint refusing CLINICIAN-VERIFIED without a clinician.',
  },
  {
    criterion: 'Clinical governance has approved live content',
    kind: 'organisational',
    evidence:
      'NOT DONE, and the single largest blocker. No AYUSH module exists. The consent ' +
      'notices and the common-core questionnaire ship as versions explicitly marked ' +
      'placeholder. No practitioner has authored or reviewed any clinical content, and no ' +
      'amount of engineering substitutes for that. A pilot with real patients cannot run ' +
      'on placeholder consent wording.',
  },
  {
    criterion: 'Backups and restore are proven',
    kind: 'deployment',
    evidence:
      'A restore drill is documented with verification queries, including the step people ' +
      'forget — documents are encrypted before storage, so a restore without the key ' +
      'produces a complete-looking system in which no document opens. No backup job exists ' +
      'in this repository, and no drill has been run against a real backup.',
  },
  {
    criterion: 'Hospital privacy and legal review is complete',
    kind: 'organisational',
    evidence:
      'NOT DONE. Needs a data-protection impact assessment, a processor agreement, and an ' +
      'approved retention and deletion policy. The retention machinery is built and refuses ' +
      'to delete anything until a hospital records an approved policy.',
  },
  {
    criterion: 'Hospital IT runbooks are complete',
    kind: 'deployment',
    evidence:
      'Five runbooks exist — alerts, breach response, backup and restore, QR and token ' +
      'failures, kiosk device setup — and every alert is checked to have one. They are ' +
      'written against this system; a hospital adds its own escalation paths and contacts.',
  },
  {
    criterion: 'Pilot acceptance metrics are met',
    kind: 'organisational',
    evidence:
      'NOT STARTED. Needs three kiosks in a corridor, an AYUSH department, and real ' +
      'patients. Phase 17 lists each pilot criterion and why it is blocked.',
  },
];

export interface ReadinessVerdict {
  readonly ready: false;
  readonly automatedPassing: number;
  readonly automatedTotal: number;
  readonly blockers: readonly ChecklistItem[];
}

/**
 * Always `ready: false`.
 *
 * Deliberately not a computation that could one day return true. Whether a clinical system
 * may see real patients is a judgement a hospital makes with a practitioner and a lawyer in
 * the room; a function in a repository that announced it would be worth exactly nothing and
 * would be quoted by somebody in a hurry.
 */
export function evaluateReadiness(): ReadinessVerdict {
  const automated = PRODUCTION_CHECKLIST.filter((item) => item.kind === 'automated');
  return {
    ready: false,
    automatedPassing: automated.filter((item) => item.satisfied === true).length,
    automatedTotal: automated.length,
    blockers: PRODUCTION_CHECKLIST.filter(
      (item) => item.kind !== 'automated' || item.satisfied !== true,
    ),
  };
}
