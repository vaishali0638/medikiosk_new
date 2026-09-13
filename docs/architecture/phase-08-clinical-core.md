# Phase 8 — New registration and common clinical core

## Objective

Structured patient history, with no AI dependency.

## The shape of the thing

The questionnaire is **data**, not code. A clinician changing a question must not require
a deployment, and a developer must not be able to change one without review. The content
lives in `governance_version`; the engine that walks it lives in the API.

```
packages/questionnaire_schema   the schema, the branching language, the engine
governance_version              the published content, per language, versioned
services/core_api/src/intake    loads, walks, validates, records
```

## Why the branching language is deliberately tiny

`ALWAYS`, `ANSWERED`, `EQUALS`, `IN`, `ALL`, `ANY`, `NOT`. It cannot loop, cannot call
out, and cannot express anything whose result depends on something other than the answers
already given.

That narrowness is the point. The specification is explicit that a model must not choose
the clinical interview, and the way to _guarantee_ it is to make the control flow
something a reviewer can read in full and a machine evaluates deterministically. The same
answers always produce the same next question, so a completed interview can be replayed
from the stored answers plus the version — which is what makes it auditable.

## Declining is a first-class answer

Every question offers `NOT_SURE`, `PREFER_TO_DISCUSS_WITH_DOCTOR` and `NOT_APPLICABLE`,
and `validateQuestionnaire` refuses a release where any question offers none.

On screen they are the same size and in the same list as the substantive options — not
below a divider. A patient who is unsure should not have to work harder than one who is
certain, because a kiosk that makes declining awkward gets a guess, and a guess recorded
as a clinical answer is worse than no answer: the doctor cannot tell them apart.

The API refuses a non-committal answer combined with a substantive one. "Not sure, and
also knee pain" is not a coherent record.

## Sensitive questions

Smoking, alcohol, family history and mental wellbeing are marked `sensitive`, and a
release that marks a question sensitive without supplying its explanation is refused at
publish time — the "why are we asking?" rule is meaningless without the text it shows.

The explanation is shown **before** the question, and declining from that screen carries
the same weight as answering. The patient can decline without ever seeing the question,
which is the point: being asked at all is the intrusion.

## Answers append

Every answer is a new revision, never an overwrite, and carries its questionnaire version,
question id, source, modality and language. A patient who changes their mind on the review
screen produces a second revision and the doctor can see that they did — which matters
when the change is "actually I do take that medicine".

`source` and `modality` are required, never defaulted: a default would quietly label a
voice transcription as a touch selection the moment someone forgot to set it.

## Consent is re-checked on every call

Not once at the start of the interview. A patient can withdraw mid-intake, and the next
question must not be served after they have.

## The content is a placeholder, and says so

The seeded common core has 21 questions following the specification's structure. Not one
phrase has been reviewed by a practitioner. Two things make that impossible to miss:

- the version is `0.1.0-placeholder` — a **pre-release**;
- its approval is recorded as `SEED-PLACEHOLDER / NOT_A_REAL_APPROVAL`.

And the suffix is load-bearing rather than decorative: `validateQuestionnaire` refuses a
plain release version that names no approver. So a version _without_ a suffix is a claim
that someone signed it off, and that claim is checked.

Only English is published. An unreviewed translation of clinical questions would be worse
than offering none, so Hindi intake is unavailable until it has been translated _and_
reviewed — the same rule as the consent notice.

## Test results

| Suite                                 | Count | Status  |
| ------------------------------------- | ----: | ------- |
| Questionnaire engine                  |    24 | Passing |
| Backend unit                          |    89 | Passing |
| HIS adapter                           |     9 | Passing |
| Backend integration (real PostgreSQL) |   213 | Passing |
| Flutter widget and unit               |   195 | Passing |

Walked end to end: 21 questions published, 17 applicable once a branch is skipped, the
whole interview completable by declining every question, and a changed answer appending a
second revision that the review screen reflects.

## Two constraints the engine disproved

Both were the same mistake in different places: `^\d+\.\d+\.\d+$` treats semver's release
form as the only form.

Unreviewed content needs to be distinguishable from reviewed content at a glance, in every
record that references it — and semver already has the mechanism. Migration `0012` relaxes
`questionnaire_response.questionnaire_ver` and `governance_version.semver` to allow a
pre-release suffix, and the schema-level rule above makes its absence meaningful.

## Known limitations

- **The content is not clinically approved** and cannot be shown to a real patient. This
  is Phase 0 and Phase 14 work, not engineering.
- **No AYUSH modules.** Phase 9 adds them on top of this core.
- **The interview is not wired into the kiosk shell.** The renderer, the engine and the
  API are all built and tested; the shell journey that walks a patient through them is
  the remaining piece.
- **No voice.** `modality` accepts `VOICE`, and nothing produces it — ASR is Phase 11.
- **No document upload.** Phase 10.
- **The demographics form is still not built.** The API path exists (pre-check-in carries
  demographics, and `/identity/register` promotes a provisional patient); the kiosk screen
  that collects them does not.
- **Branching is evaluated server-side**, one round trip per question. Simpler and
  auditable — a single implementation nobody can get subtly wrong — but it means the
  interview does not work offline. Given a token cannot be issued offline either, that is
  a consistent limitation rather than a new one.

## Exit criteria

| Criterion                                | Status                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Common history can be completed by touch | Verified — the full interview, declining every question                            |
| Answers are versioned                    | Verified — questionnaire version stored on every row                               |
| Every answer has source and modality     | Verified — required, not defaulted                                                 |
| Patient can select unknown               | Verified — three non-committal answers, equally weighted, enforced at publish time |
| Review screen receives structured data   | Verified — questionnaire order, latest revision, provenance                        |
| No AI is required for core functionality | Verified — the branching language cannot express a model call                      |
