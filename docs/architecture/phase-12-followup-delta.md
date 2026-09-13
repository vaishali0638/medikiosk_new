# Phase 12 — Regular follow-up delta

A returning patient should not re-answer twenty questions they answered last month. But the
efficient version of that — copying the previous visit forward — is how a stale medication
list becomes a current one. This phase asks only what changed, against a baseline that is
specifically **not** whatever the system said last time.

The rule is one sentence:

> **Use the last clinician-verified visit, not the last AI draft.**

## What "clinician-verified" had to mean

Phase 2 created `encounter` and `follow_up_delta`, and `follow_up_delta` requires a
`previous_encounter_id`. Nothing had ever written an encounter row, and nothing had ever
marked anything verified — so the baseline had nowhere to point. Phase 12 had to establish
what a verified visit _is_ before it could look one up.

**An encounter is now created when a token is issued** (migration `0018`). That is the
moment the visit becomes real: the hospital has queued this patient. Before it, there is
only an intention to be seen. It is created idempotently — a reconciliation sweep that
discovers a token was issued after all must not produce a second encounter, or the patient
acquires two clinical visits for one attendance.

**Verification is three columns that move together:**

```sql
CONSTRAINT encounter_verification_is_complete CHECK (
  (verified_at IS NULL AND verified_by_user_id IS NULL AND verified_summary_id IS NULL)
  OR
  (verified_at IS NOT NULL AND verified_by_user_id IS NOT NULL AND verified_summary_id IS NOT NULL)
)
```

A signature with no name is not a signature, and a name with no time cannot be ordered
against the next one.

## Why a draft cannot become history

Three independent things, and the third is the interesting one:

1. The baseline query requires `encounter.verified_at IS NOT NULL`.
2. It joins the summary the clinician **named** in `verified_summary_id` — not the newest
   summary for that visit. A draft generated afterwards, by a re-run or a newly enabled
   model, cannot displace what was actually confirmed.
3. It re-asserts `provenance_label = 'CLINICIAN-VERIFIED'`, which Phase 11's
   `clinical_summary_verified_label` constraint already refuses unless a clinician and a
   timestamp are recorded. A draft **physically cannot carry that label**. Asserting it
   again here means a future change that loosened the constraint breaks this query rather
   than silently promoting generated text into a patient's history.

Nothing in the product verifies anything yet — that is Phase 13 — so in practice this
returns null and the patient gets a full intake. Which is correct: there is no verified
history to measure against.

## Three groups, never one list

`UNCHANGED` / `CHANGED` / `NOT_CONFIRMED`, kept apart from the database to the response.

**Unchanged items are listed, not omitted.** A delta of changes alone leaves the doctor
unable to tell "the hypertension is stable" from "nobody asked about the hypertension", and
those call for different consultations.

**A carried-forward item keeps its own provenance** — `CLINICIAN_VERIFIED`, not
`PATIENT_REPORTED`. It is what a clinician confirmed, and it goes on saying so rather than
being relabelled as something the patient said today.

**Not-confirmed has two sources**: a non-committal answer ("I am not sure", "I prefer to
tell the doctor") and a document whose extraction is still awaiting review — the
specification's "prescription dose unclear". Only the **latest** revision of each answer
counts: a patient who said "not sure" and then corrected themselves on the review screen has
confirmed it, and showing the superseded answer would put a resolved uncertainty in front of
the doctor as an open one.

## Item identity is the source, not the sentence

The delta's unique index was originally `(pre_checkin_id, item_kind, item_label)`, and it
broke the first time it met a real record. A patient who answers several questions "I am not
sure" produces byte-identical statements under one section heading, and they are different
items. Identity is now `item_ref` — the question id, document id or section the item came
from.

## What the walkthrough found

Four things, none caught by 294 passing tests:

**A malformed id returned 500.** `GET /v1/precheckins/not-a-uuid/documents` passed straight
into Postgres and came back as an internal error with a stack in the log. Three things wrong
with that: a malformed request is the client's fault and should be a refusal; a 500 on every
junk id makes scanner traffic indistinguishable from a real fault; and 500-for-junk against
400-for-unknown told an unauthenticated caller which ids were well-formed. A `UuidParamPipe`
now refuses them identically, on every endpoint that takes an id.

**A second identity attempt returned 409.** `IDENTITY_PENDING` had no self-transition, so a
patient who tried their mobile number, was refused, and then reached for their hospital card
found the session wedged. The existing-patient screen offers three methods precisely so they
can try another. `QR_ISSUED` already had exactly this self-loop for the same reason.

**`Patient reported: "NOT_SURE"` reached the clinician's draft.** Non-committal answers are
not in `question.options` — they are a separate, always-available set — so the label lookup
fell through to the raw id and put an internal identifier in a clinical record.

**The item-identity bug above**, which only appears with a realistic record.

## A change I made and reverted

Mobile OTP is a `MODERATE` match and only `STRONG` or better may release a patient record,
so "Existing patient → Enter mobile number" can never succeed. That looked like a defect —
a specified journey that always dead-ends — and a misleading comment ("MODERATE reached here
means a mobile OTP that could not be narrowed by a date of birth") suggested a date of birth
was meant to strengthen it. So I made a verified date of birth upgrade the match to STRONG.

An existing Phase 5 test caught it:

> _"Narrowing removes the ambiguity but does not raise the evidence: a date of birth is not
> a secret."_

That is a considered decision and it is right — a birth date is on every form the patient
has filled in and is known to their whole family. It disambiguates a shared phone; it does
not authenticate. The change was reverted, the misleading comment corrected, and the real
fix made in the kiosk instead: the existing-patient screen now says a mobile number alone
means the counter **before** asking for ten digits and a code, rather than delivering the
same refusal two screens later.

## Tests

| Suite                             | Count |
| --------------------------------- | ----- |
| `test/followup.int-spec.ts`       | 15    |
| `test/followup_screens_test.dart` | 7     |

Full suites: **150 backend unit, 294 backend integration, 240 Flutter**.

Walked end to end against `dist/main.js`: a complete first visit to token `AYU-0001`, an
encounter created by the token issue, a return visit correctly finding **no** baseline while
nothing was verified, then a clinician verification, then the same query returning the
verified record with all seven sections, and a delta of 16 unchanged / 2 changed.

## Known limitations

- **Nothing verifies a visit yet.** Phase 13. Until then every returning patient gets a full
  intake, which is the correct behaviour and not a workaround.
- **The follow-up screens are not wired into the kiosk journey.** They are built and tested;
  the shell does not yet branch to them when a baseline exists.
- **No UHID is ever assigned.** A newly registered patient has no hospital identifier, so
  they cannot use the UHID route on a return visit at all. In a real deployment the HIS
  issues one; nothing in this repository does.
- **`SECTION_FOR_BASELINE` is a fixed map.** Which follow-up question can contradict which
  section of a record is hard-coded rather than governed content.
- **Change detail is free text.** "Metformin reportedly stopped" in the specification's
  example is a sentence a clinician reads, not a structured medication change.

## Exit criteria

| Criterion                                           | Status                                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Previous AI drafts are not used as verified history | Verified — three independent controls, one of them a database constraint from Phase 11 |
| Changes are separated from unchanged information    | Verified — three groups from the table to the response, never concatenated             |
| Not-confirmed fields are prominent                  | Verified — their own group, from non-committal answers and unreviewed extractions      |
| Doctor can inspect the previous verified record     | Verified — the record itself is returned, not a summary of it                          |
