# Phase 11 — Patient review and safe AI draft

This is the first phase where a model is allowed anywhere near clinical text. The work is
almost entirely about what happens to that text before a clinician sees it.

Two things are built:

1. **The patient's review** — they check their own answers, and cannot submit without
   confirming they did.
2. **The clinician's draft** — a narrative that must survive a safety gate before anyone
   reads it.

## No model ships here

The same position as OCR in Phase 10, for the same reason: this repository will not
contain a generator wired to a real hospital's patient data on a developer's judgement.
What ships is the interface, the gate, and a **deterministic composer** that produces a
complete, labelled draft from the structured answers with no model involved.

That composer is not a stub. With `FEATURE_AI_SUMMARY` off — the default — it is what every
clinician actually reads, and it satisfies the exit criterion "AI unavailable falls back to
structured touch workflow" by being the normal path rather than a degraded one.

## The gate

`validateDraft(candidate, groundingMaterial)` is a pure function that judges a draft
without knowing where it came from. It returns **every** problem, not the first: a
generator being tuned against it should see the whole picture in one pass.

**Banned language.** Three families, in `packages/terminology/src/draft-safety.ts`:

- _Diagnostic_ — `Diagnosis:` headings, but more importantly the hedged forms:
  "suggestive of", "consistent with", "most likely", "cannot rule out". The specification's
  example is the easy case. What actually reaches a clinician is inference that reads as
  clinical reasoning and carries the authority of the system that printed it.
- _Treatment_ — "recommend", "advise", "should take", "remedy". Note what is **not** banned:
  a dose. "Patient reports taking Metformin 500 mg" is a patient-reported fact and one of
  the more useful things in an intake. The banned thing is the recommending voice.
- _Urgency_ — red-flag handling is internal by design (§16). A draft that says "urgent" is
  the urgent-help button by another route, and makes a promise the hospital may have no
  workflow to keep.

**Grounding — an allowlist, not a blocklist.** Every content word in a draft must be either
a word the patient actually used, or one of about 120 scaffolding words. A blocklist of
disease names cannot work: there are tens of thousands of them in several languages, and a
generator that invents one not on the list passes. Requiring support instead means an
invented condition fails _regardless of what it is called_ — the test for this uses
"gonarthrosis", and it fails without anyone having heard of it.

Numbers are grounded too. A fabricated number in a clinical draft is a dose or a duration
waiting to happen.

**The patient's own words are exempt from the banned scan.** A patient who says "it is
probably from lifting a sack" has said something a doctor should read verbatim; refusing
the draft over their word "probably" would either lose the detail or force a paraphrase of
a symptom description, which is worse than the phrase it avoided. So quoted spans are
skipped by the banned-language scan — and this cannot be used to smuggle a diagnosis in,
because a quote can only contain words the patient used. Quoting `"likely rheumatoid
arthritis"` fails the grounding check instead. There is a test for exactly that.

**The absence of a diagnosis is stated, not implied.** `Clinical diagnosis has not been
provided.` is required in every narrative. A clinician skimming a structured draft can read
silence as "nothing found"; they cannot misread that sentence.

## The composer is judged by its own gate

The deterministic composer's output is run through `validateDraft` in a unit test. This is
the load-bearing test of the phase:

> A validator its own author's output cannot pass is one nobody will trust, and one that is
> only ever run against a model has never been tested against a known-good input.

It also constrains the composer usefully. It cannot emit "Answered 3 of 21 questions",
because 3 and 21 are numbers nobody said.

## What a refusal does

Nothing dramatic. The refused candidate is **stored** — it is the evidence of what a
generator tried to put in front of a clinician, and deleting exactly the events worth
reviewing would be the wrong instinct — the deterministic composer runs, and the patient's
visit continues at full speed. The audit event carries the rule codes and not the text.

Two rows result: one `REJECTED` (the model's) and one `ACCEPTED` (the rules'). The read
endpoint serves only accepted drafts.

## Safety as constraints, again

Migration `0016` puts two properties in the database rather than in code:

```sql
review_confirmed boolean NOT NULL CHECK (review_confirmed)
```

An unconfirmed submission row **cannot exist**. The application check above it produces a
useful error message; the constraint is the actual control, and it survives a refactor that
deletes the check. There is an integration test that inserts directly and expects a throw.

```sql
CONSTRAINT clinical_summary_verified_label CHECK (
  (provenance_label = 'CLINICIAN-VERIFIED'
     AND verified_by_user_id IS NOT NULL AND verified_at IS NOT NULL)
  OR
  (provenance_label = 'AI-ASSISTED DRAFT — NOT VERIFIED'
     AND verified_by_user_id IS NULL AND verified_at IS NULL)
)
```

A generated narrative cannot be labelled verified. Marking one so requires a named clinician
and a timestamp, and nothing in this phase writes either — clinician confirmation is Phase 13.
`CLINICIAN-VERIFIED` is also absent from the statement-provenance enum entirely, so a
generator claiming it fails as a schema error rather than as a judgement call.

## The patient's screen shows nothing derived

Their own answers, each with the provenance label the doctor will see, and an Edit button on
every row. No narrative, no draft, no extracted text.

Asking a patient to approve a generated summary asks them to vouch for something they are not
in a position to check. And the Edit button is not decorative: a patient who spots a wrong
answer and cannot fix it either submits something they know is wrong, or walks away.

An unanswered question carries **no** provenance — `null`, not `PATIENT-REPORTED`. Labelling a
question they never answered as patient-reported attributes something to them that they did
not say, which is the exact failure provenance labels exist to prevent. This was a bug when
first written, and is now a test on both sides.

## What the walkthrough found

Three things, none of which 288 tests had caught:

**The draft opened with `Patient reports "Something else"`.** The narrative took the first
statement in the reason-for-visit section, which was the chief-complaint _option label_. The
patient had picked "Something else" and then described knee pain in their own words. Free
text now wins over a selected option — "Patient reports 'Something else'" is worse than no
opening line at all.

**A question with no options accepted any option id.** The guard was
`if (nonCommittal.length === 0 && question.options)`, and a numeric scale has no `options`,
so the check was skipped entirely. An arbitrary identifier went in and came back out in the
clinician's draft as `Patient reported: "moderate"` — a word nobody had ever shown the
patient. This was a Phase 8 defect that only became visible once answers started flowing into
a clinical narrative.

**A numeric answer vanished.** Severity is a numeric scale, and the review service rendered
only string values. The answer appeared in neither the sections nor the "not answered" list:
the patient answered, and the clinician saw nothing — worse than either outcome alone.

## Tests

| Suite                                  | Count |
| -------------------------------------- | ----- |
| `src/summary/safety-validator.spec.ts` | 20    |
| `test/summary.int-spec.ts`             | 21    |
| `test/review_screen_test.dart`         | 9     |

Full suites after this phase: **150 backend unit, 268 backend integration, 227 Flutter**.

## Known limitations

- **No generator.** The interface, the timeout wrapper and the gate are built and tested
  against a scripted generator; nothing is wired to a model.
- **The gate is English-only.** The banned patterns and scaffolding vocabulary are English.
  A Hindi or Tamil draft would fail grounding on almost every word — the composer's own
  scaffolding included. Multilingual drafting needs a reviewed vocabulary per language, which
  is governed content and belongs with the questionnaires in Phase 14.
- **Corrections are recorded, not detected.** The submission stores whatever corrections the
  client reports. Deriving them server-side from the answer revision history is
  straightforward and is not done.
- **`SYSTEM-DETECTED — REVIEW` has no rules behind it yet.** The label is used for structural
  observations ("no answer provided"). Red-flag rules are Phase 16.
- **The kiosk journey still does not wire the screens together** — review, documents, AYUSH
  selection and intake all exist and are tested in isolation, and the Phase 5 demographics
  form remains outstanding.

## Exit criteria

| Criterion                                         | Status                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Patient cannot submit without review confirmation | Verified — refused by the API, and by a database CHECK if the API check were removed |
| Summary never appears as diagnosis                | Verified — banned patterns, plus a required no-diagnosis statement                   |
| Provenance labels are visible                     | Verified — per statement, per review row, and on the draft itself                    |
| Schema validation rejects malformed AI output     | Verified — a parse failure is a refusal, and the fallback runs                       |
| AI unavailable falls back to structured workflow  | Verified — the deterministic composer is the default path, not a degraded one        |
