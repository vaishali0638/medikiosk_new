# Phase 13 — Doctor dashboard and HIS export

Everything before this phase was a kiosk (authenticated by a device certificate) or a
patient (by an OTP about themselves). A clinician is the first actor who reads **other
people's** records, so this is where the system first has to answer "who are you, and are
you allowed".

It is also where the deferred act finally happens. Phases 10, 11 and 12 all end with "a
clinician confirms this" — Phase 13 is that confirmation, and it closes Phase 12's loop:
the verification this writes is exactly what the follow-up baseline reads.

## Authentication is not authorisation

Two separate mechanisms, deliberately, because collapsing them is how a valid login becomes
access to the whole hospital.

`StaffAuthGuard` establishes **who is asking**. `EncounterAccessService` decides, per
record, whether they may see **this patient**:

1. **Role.** Only a `CLINICIAN` reads clinical records. Governance reviewers approve content
   and operations staff unstick queues; neither has a reason to read a history, and granting
   it "because they are staff" is how a hospital loses the ability to say who looked at whom.
2. **Facility.** The encounter must belong to the clinician's own hospital.
3. **Department.** A doctor sees their own department. Anything else needs break-glass.

**A refusal is always the same code, status and body** whether the encounter does not exist,
is at another hospital, or is in another department. A clinician trying ids must not be able
to learn which. There is a test that asserts the foreign-record and unknown-record responses
are byte-identical.

## MediKiosk cannot authenticate a doctor

It holds no staff password and never will. Hospitals run their own directory, and a clinical
system with a parallel credential set is a second thing to deprovision when someone leaves —
which is the failure that leaves a former employee holding access to patient records.

`StaffIdentityProvider` is the seam. The sandbox implementation **refuses to construct** when
`NODE_ENV=production`, rather than refusing at call time: a deployment that reached production
with it wired in would otherwise look healthy until the first person typed a colon into a
username. With nothing configured, `UnconfiguredStaffIdentityProvider` lets nobody in.

**Signing in does not create an account.** A hospital provisions its clinicians deliberately;
auto-creating one for any subject the IdP recognises would hand every porter and accountant a
clinical worklist the moment they authenticated. An unknown-but-valid subject gets the same
401 as a bad credential, because distinguishing them tells an outsider who works there.

## Break-glass

Access outside the clinician's department needs a typed reason of at least ten characters,
and it goes in its own table rather than a flag on an audit event — it is the one access a
human is expected to review afterwards, and that should not mean filtering a table of
millions of ordinary events. It is also logged at WARN: a burst of break-glass is the signal,
and a signal nobody sees until someone runs a report is not a control.

## Confirmation writes a second row

The clinician's confirmation creates a **new** `clinical_summary` rather than updating the
draft. Overwriting would destroy the evidence of what they were shown when they signed, which
is the only way to answer "what did the doctor actually see" after a disagreement.

Both rows and the encounter's verification commit in one transaction. A verified encounter
pointing at a summary that does not exist, and a `CLINICIAN-VERIFIED` summary no encounter
references, are both worse than neither.

Re-confirming is idempotent: it returns the existing signature rather than replacing one
clinician's with another's.

## Export

Separate from the token adapter, and the migration comment says why: a token is a queue
position, and if one is lost the patient asks again. A clinical record is what a future
clinician treats from, and a duplicate is a second version of the truth someone reconciles by
hand. Same hospital, same network, very different consequences — so they do not share an
interface or a retry policy.

**Only a confirmed record exports.** The check is `encounter.verified_at`, which cannot be set
without a named clinician and a `CLINICIAN-VERIFIED` summary. It is a refusal in the service,
not a greyed-out button.

**Idempotent in three places**: a derived key (never client-supplied), a UNIQUE column so
concurrent calls collapse, and a partial unique index refusing a second `SENT`/`ACKNOWLEDGED`
row per encounter.

**An uncertain outcome asks before retrying**, exactly as the token path does, and parks in
`RECONCILIATION_REQUIRED` if it still cannot tell. The sandbox adapter deliberately records
the export even when it answers `UNCERTAIN` — modelling a real HIS that committed and then
timed out, which is the case a blind retry duplicates.

## Short-lived signed document links

A clinician's browser renders a prescription image, and an `<img>` tag cannot carry an
Authorization header. The alternatives are a cookie that then authorises every request the
page makes, or a URL that is itself the credential. This is the second, made safe by lasting
two minutes — and the signature binds the document **and the staff user**, so a link pasted
into a chat does not work for whoever receives it even inside the window.

## What the walkthrough found

**The case view offered a link to bytes that do not exist.** A refused document was listed
with a signed link like any other, so the one document a clinician most wanted to look at was
the one whose link always failed. Refused documents are now listed — the clinician should
know the patient tried to supply something — with `link: null`.

**A missing `MALWARE_SCANNER` refused the upload**, which is Phase 10's fail-closed behaviour
working correctly; the walkthrough was under-configured, not the code.

**`encounter_export` had no optimistic-concurrency column**, caught by the schema-parity test
rather than the walkthrough. Its state is read and written across an adapter call, and a stale
write could report a rejection over an acknowledgement.

## Tests

| Suite                     | Count |
| ------------------------- | ----- |
| `test/doctor.int-spec.ts` | 25    |

Full suites: **150 backend unit, 319 backend integration, 240 Flutter**.

Walked end to end against `dist/main.js`: a kiosk visit through to token `AYU-0001` with a
document; two clinicians and an operations user provisioned; the Unani doctor refused and then
admitted by break-glass; operations refused outright; the case read with its unverified banner;
the signed link serving the real JPEG and a tampered signature refused; export refused before
confirmation; confirmation producing a second summary; export acknowledged and idempotent on a
second call; and five distinct audited actions.

## Known limitations

- **No real SSO.** OIDC/SAML against a hospital IdP is configuration and a provider
  implementation; only the sandbox exists.
- **No doctor web UI.** `apps/doctor_web` is still a placeholder. Every endpoint above is
  built and tested, but nothing renders them.
- **No examination/assessment/plan capture.** The specification's doctor flow includes it; the
  confirm endpoint accepts whatever record the clinician submits, with no structured fields
  for their own findings.
- **No FHIR mapping.** The export adapter passes the internal record shape; an R4 mapping is
  Phase 18's interoperability work.
- **Break-glass is recorded, not alerted.** It lands in a table and a WARN log; nothing pages
  anyone or produces the periodic review that makes it meaningful.
- **Sessions are bearer tokens with no refresh**, and eight hours is a shift with no
  re-authentication for sensitive actions.

## Exit criteria

| Criterion                                        | Status                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| Doctor can find the current patient              | Verified — worklist scoped in the query, searchable by token or UHID              |
| Consent/access policy blocks unauthorised access | Verified — role, facility and department, with identical refusals                 |
| Original documents open                          | Verified — short-lived signed links, bound to the document and the staff user     |
| AI/OCR labels show                               | Verified — the unverified banner, per-statement provenance, extraction confidence |
| Doctor can correct and confirm                   | Verified — confirmation writes a new signed record and leaves the draft intact    |
| HIS export is idempotent and reconciled          | Verified — three layers of idempotency; uncertain outcomes ask before retrying    |
