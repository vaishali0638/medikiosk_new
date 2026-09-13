# The doctor and governance consoles

Phases 13 and 14 built and tested every endpoint these two surfaces need, and left both
`apps/doctor_web` and `apps/governance_web` as placeholder READMEs. This builds them.

The reason for doing it before Phase 17 is the same one that applied to the kiosk journey
earlier: **screens that exist and pass their own tests but that nobody can reach hide
defects that only appear when a person uses them.** Wiring the kiosk together turned up a
broken Exit button on every screen. Building these turned up three more, none of which any
of the 399 backend tests could have found.

## What the browser found

**No CORS, anywhere.** The API had no CORS configuration at all. The kiosk is a native
application and is not subject to it, so its absence had been invisible for sixteen phases —
and both consoles are browser applications on their own origins, so _every_ request they
made was blocked before it left the browser. The API logged nothing, because nothing arrived.
Now an allowlist from `CORS_ALLOWED_ORIGINS`, off by default, with credentials **not**
enabled: these clients send a bearer token they attach deliberately, never a cookie the
browser attaches for them, which is what keeps CSRF off the table.

**The CSP broke Next.js in development.** Copied from `patient_pwa`, which has the same bug:
Next's dev server compiles modules with `eval` for hot reload, and `script-src` had no
`'unsafe-eval'`. The result is subtle and nasty — the page renders correctly from the server
and is completely inert, because the client bundle throws before React hydrates. Every form
silently does nothing. Fixed in all three apps, development only; the production build needs
no `eval` and does not get it.

**The governance console could not tell a reviewer why a release was refused.** This is the
interesting one. Phase 14's gate deliberately returns _every_ problem at once so an author
can fix them in one pass — and the reviewer saw "Some information could not be accepted",
the neutral patient wording, because `internalDetail` never leaves the server.

That rule is right nearly everywhere: a kiosk stands in a public corridor and an error that
explains itself is an oracle for probing stolen codes and unknown ids. It is wrong here. A
governance reviewer is authenticated, role-checked, and is the person who has to act on the
reason. `StaffFacingError` is now the single, explicit exception — a distinct class rather
than a flag, so every place that discloses a reason can be found by searching for the type,
and a test asserts that patient-facing and unauthenticated refusals still carry no `detail`.

## The clinician dashboard

Sign in, worklist, case, correct, confirm, export.

**The draft cannot be mistaken for a record.** An amber left border, an uppercase
`AI-ASSISTED PRE-CONSULTATION DRAFT — NOT VERIFIED` banner, and a provenance label on every
single statement — three signals, because a doctor moving between patients can miss any one.
On confirmation the same block turns green and the banner changes to `CLINICIAN-VERIFIED
RECORD`; nothing else about the layout moves, so the difference is colour and words rather
than a rearrangement that has to be re-read.

**Confidence is shown here and nowhere the patient can see it.** A clinician verifying an
extraction is exactly who a confidence number helps; a patient is not.

**Break-glass is a screen, not an error.** A refusal offers a reason box and says plainly
that somebody will read what is typed there.

**The worklist searches by token or UHID, not by name** — searching by name would make it a
way to check whether a particular person attended, which department scoping exists to
prevent.

## The governance console

**It only offers moves the state machine permits.** There is no button from a draft to
published, because there is no such edge.

**The distinct-approver count is on screen** — "3 approval(s) from 2 distinct people" — so a
reviewer notices before the server refuses. One person holding four roles is not four checks.

**What the hospital cannot yet run is listed first**, per language, because a kiosk with no
published consent notice in a language it offers stops dead for every speaker of it.

## Verified in a browser

Driven end to end in a real browser, not asserted from a test harness.

_Clinician_: signed in as `dr.sharma` → worklist showing `AYU-0001`, `M**** R**`, "Draft
ready · 1 document(s)" → case with the unverified banner and a label on every statement →
confirmed, banner turning to `CLINICIAN-VERIFIED RECORD` → exported, `Sent to the EMR
(EMR-export-9)`.

_Governance_: signed in as `gov.chair` → "Not yet publishable: common-core/hi" → authored a
Hindi questionnaire draft → sent for review → recorded two approvals from **one** person →
`Mark approved` refused with **"not approvable: needs 2 distinct approvers, found 1"** →
added a second reviewer → approved → published → the "not yet publishable" panel gone.

## Known limitations

- **Sign-in is the sandbox provider.** In a real deployment both pages are replaced by a
  redirect to the hospital's OIDC endpoint.
- **Correction is a JSON textarea.** A clinician correcting a record edits the structured
  document directly. It is honest and it works, but a real deployment wants per-statement
  editing with the provenance label following the edit.
- **No examination, assessment or plan fields.** The specification's doctor flow includes
  them; the confirm endpoint takes whatever record is submitted and there is nowhere to type
  a clinician's own findings.
- **No tests.** Both apps are covered only by the browser walkthrough above and by the
  backend's own suites. Component tests would need a test runner and DOM setup neither app
  has yet, and `npm test` in both is `--passWithNoTests`.
- **No pagination on either list.** A busy OPD worklist and a hospital with hundreds of
  releases will both need it.
