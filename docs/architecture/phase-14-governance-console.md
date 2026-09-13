# Phase 14 — Clinical governance console

Phase 9 built the approval **gate**: a function that says whether a release carries the
named approvals its content kind requires. What was missing was everything around it — who
published, when, to which kiosks, and what a rollback actually does. A gate nobody has to
walk through is a suggestion.

## The lifecycle is a state machine

A fifth machine, alongside the kiosk session, pre-check-in, token request and consent:

```
DRAFT ⇄ IN_REVIEW → APPROVED → CANARY → PUBLISHED → ROLLED_BACK
```

The safety-critical shape is that **there is no edge from DRAFT to PUBLISHED**. The approval
gate is checked on exactly one transition — `IN_REVIEW → APPROVED` — and everything
downstream inherits that check by being unreachable without it. Publication does not
re-check because it cannot be reached by a path that skipped it. A graph-cut test asserts
that every path from DRAFT to PUBLISHED passes through APPROVED, and every path to APPROVED
through IN_REVIEW.

`CANARY` sits **between** APPROVED and PUBLISHED rather than beside it. A canary is a real
release to a subset of kiosks, so it clears the same approvals; the difference is blast
radius, not scrutiny.

`ROLLED_BACK` is terminal. Rolling back does not return a version to draft to be edited and
re-released under the same number — that number is what a clinical record cites when it says
which questionnaire a patient answered, and it must keep meaning one thing forever.

`IN_REVIEW → DRAFT` exists: a reviewer sending something back is the normal case, not a
failure.

## Canary actually delivers

A canary names the kiosks it reaches, and the content lookup resolves per kiosk: the canary
version for a named kiosk, the published version for every other, and the published version
for a caller with no kiosk at all — a patient's own phone is never in a canary. Both versions
are live at once, which is the entire point, so the one-published-per-key index deliberately
does not cover CANARY.

## What is enforced in the database

- **Nothing live without a named publisher.** `governance_version_live_is_published`. A live
  version whose publisher is unknown cannot be reviewed after an incident, which is the only
  moment anyone looks. This broke every existing fixture and the seed script, which had all
  been publishing content anonymously — that was the gap, and they now name a publisher.
- **A canary must name its scope.** An empty canary is a full release wearing a label that
  says otherwise.
- **A rollback must be explained**, by whom and when, with at least ten characters of reason.
  A rollback with no stated reason tells the next reviewer nothing about whether the problem
  was ever fixed.
- **At most one published version per key** — already true from migration 0002, so this phase
  reuses it rather than adding a second index saying the same thing.

## Validation happens at authoring

A questionnaire that fails its schema is rejected while the author is still looking at it,
not three reviews later when four people's time has been spent on something that was never
loadable.

Beyond the schema, two structural checks the schema cannot express: duplicate question and
option ids, and **branching on a question asked later**. That last one produces content that
looks complete to a reviewer and asks the patient nothing — the condition can never be true,
so the question it guards is unreachable.

## Three findings

**The payload could lie about its version.** `findPublished` preferred the payload's own
`version` field over the registry `semver`, so a release governed as `1.0.0` could hand the
kiosk content calling itself `0.1.0-placeholder`, and every answer would cite the claim
rather than the release it came from. Two sources of truth for one version number is the
bug. The registry semver now wins — it is what the approval gate checks, what is unique per
key, and what a rollback moves between. The pre-release marker moved with it, so the gate
can actually see it: fixtures now publish `semver: '0.1.0-placeholder'` rather than hiding
the marker inside the payload where nothing checks it.

**The rollback pointer was required with no way to supply it.** `checkPublishable` demands
one on every non-first release, and nothing in the API set it — the integration test had to
write it directly to the database. A requirement with no means of satisfying it is how a
governance rule becomes something people route around. It is now derived from whatever is
live for that key, which is by definition the version being superseded, and removes a manual
step that gets typed wrong under pressure — which is exactly when a rollback pointer is used.

**The effective date was checked on one edge and set on another.** The gate required it at
APPROVED; the workflow only supplied it at PUBLISHED, so nothing could ever be approved. When
content takes effect is part of what reviewers sign off, so it is now set on the approval
edge, defaulting to now.

There was also an ordering bug of my own: the rollback restored the superseded version
_before_ the rolled-back one left `PUBLISHED`, so the two briefly coexisted and the unique
index refused the whole thing. Both now happen in one transaction, in the right order, so
there is no moment with neither.

## "No live content lacks a version", as a query

`GET /v1/governance/unversioned` reports what a hospital has nothing published for, **per
language**. A hospital offering Hindi with no Hindi consent notice is not partly ready — it
is a kiosk that stops dead for every Hindi speaker, and a summary saying "consent notice:
published" would hide that. Stated as a criterion it is a promise; asked as a query it is
checkable, and a console can show it as a list of things to approve before the kiosk is
usable.

## Tests

| Suite                         | Count |
| ----------------------------- | ----- |
| `test/governance.int-spec.ts` | 22    |
| governance state machine      | 4     |

Full suites: **154 backend unit, 341 backend integration, 240 Flutter**.

Walked end to end against `dist/main.js`: a clinician refused; unparseable content refused at
authoring; publication from draft refused by the machine; one person in two roles refused by
the gate; a second distinct reviewer accepted; a canary on one kiosk running alongside the
published version; publication retiring the placeholder; a second version deriving its
rollback pointer automatically; a reasonless rollback refused; a reasoned one restoring v1
with no outage; a rolled-back version refused re-publication; and the full transition history.

## Known limitations

- **No governance web UI.** `apps/governance_web` is still a placeholder, as is
  `apps/doctor_web`. Every endpoint is built and tested; nothing renders them.
- **Canary monitoring is not built.** The specification's workflow is "canary → monitoring →
  publish or rollback". The canary and both outcomes exist; deciding between them is a human
  reading dashboards that do not exist yet.
- **Content kinds beyond questionnaires and consent notices get a weak check.** Terminology
  sets, medicine dictionaries, OCR confidence policies and summary templates are listed in
  the specification as governed content; the registry accepts them but only checks they are
  JSON objects.
- **Approvals are self-asserted.** A reviewer records "approved by Dr Sharma" — the system
  does not verify that the signed-in user _is_ Dr Sharma, or that Dr Sharma holds a BAMS.
  Binding approvals to authenticated staff identities is a natural next step now that Phase
  13 has those identities.
- **No audio prompt or translation-string management**, both named in the specification.

## Exit criteria

| Criterion                                      | Status                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| No live content lacks a version                | Verified — a database constraint, plus a query that lists what is missing per language     |
| No high-risk change has single-person approval | Verified — distinct-approver counts per content kind, checked on the one edge that matters |
| Rollback works                                 | Verified — including restoring the superseded version, so a rollback is not an outage      |
| Every release is audited                       | Verified — a transition row and an audit event per state change, each naming an actor      |
| Kiosk receives only published configuration    | Verified — and a canary reaches only the kiosks it names                                   |
