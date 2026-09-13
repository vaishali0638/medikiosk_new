# Phase 9 — AYUSH modules

## The exit criterion this phase cannot meet

> **One AYUSH module is live and approved.**

It is not, and nothing in this repository can make it so. An Ayurveda module requires a
registered BAMS practitioner to author it, a second to review it clinically, a translation
reviewer per language and a safety reviewer. There is no clinical governance group — that
is Phase 0, and it is organisational work.

The specification is explicit: _"Every module must be approved by qualified practitioners
of that system. An LLM must not invent clinical protocols or select a remedy."_ Prakriti
and Vikriti assessment is diagnostic reasoning within a system of medicine. Generating
plausible-looking questions for it would produce something that **reads** as clinical
content, would be indistinguishable from the real thing to a reviewer skimming it, and
would be wrong in ways only a practitioner could detect. That is a worse outcome than an
empty file.

So this phase built the machinery that makes the missing approval **impossible to ignore**,
rather than content that papers over it.

## What was built

**A four-role approval gate.** An AYUSH module cannot be published without an author, a
clinical reviewer, a translation reviewer and a safety reviewer; at least two of them must
be distinct people; the author and clinical reviewer must state a qualification; there
must be an effective date and, unless it is the first release, a rollback pointer.

One person holding all four roles is not four checks, and "reviewed by a practitioner"
means nothing without saying a practitioner of what.

**Enforced twice.** `checkPublishable` does the detailed work in code, where it can be
read and tested. A CHECK constraint independently refuses a published `AYUSH_MODULE` with
fewer than four approvals or no effective date — because a rule living only in application
code can be bypassed by a migration, a script, or a future endpoint that forgets to call
the service, and clinical content reaching a patient unreviewed is the failure this phase
exists to prevent.

**Composition.** Core first, then the module. An intake abandoned halfway still carries
the universally useful history, and a module later withdrawn does not take the core with
it. Question-id collisions are refused rather than silently resolved: two meanings for one
stored answer is not something to paper over. Both versions travel on every answer —
`0.1.0-placeholder+ayurveda.1.0.0` — because an answer must be reconstructable from what
the patient was actually shown, which was the composition and not either half.

**Availability.** A system is offered only when it has _both_ an enabled department _and_
an approved module. Offering one without a module would let a patient choose a system of
medicine and then be asked nothing specific to it, which looks like the module failed
rather than like it was never approved.

**Six module skeletons.** Section headings transcribed from the specification, with zero
questions and every section marked `AWAITING_AUTHORSHIP`. A test asserts they stay empty.
They exist so the work is scoped, not so it looks done.

**Selection screen.** "I am not sure" carries the same weight as any system, because not
knowing which system of medicine you want is the normal case. Choosing it does not block
the visit — the core is collected either way and the doctor decides.

## Graceful degradation

A hospital may run an Ayurveda OPD long before its module has been through review. In that
case the patient gets the common core alone rather than an error: collecting the history
every clinician needs is better than refusing the patient. Which module was used, or that
none was, is recorded in the version string on every answer.

## Test results

| Suite                                 | Count | Status  |
| ------------------------------------- | ----: | ------- |
| Questionnaire engine                  |    30 | Passing |
| Approval gate                         |    15 | Passing |
| Backend unit                          |   104 | Passing |
| Backend integration (real PostgreSQL) |   228 | Passing |
| Flutter widget and unit               |   204 | Passing |

Walked end to end: no module → no system offered; two approvals → refused by the database;
four → the system appears; composed version `0.1.0-placeholder+ayurveda.1.0.0` with 18
applicable questions; all six shipped skeletons contain zero questions.

## The semver lesson

Migration `0014` is the **third** widening of the same regex, and the reason was the same
each time: `^\d+\.\d+\.\d+$` encodes release versions only, and every later need turned
out to be something semver already has a form for — pre-release for unreviewed content
(`0012`), build metadata for a composed questionnaire (`0014`).

Composition originally emitted `core@module`, which is not valid semver at all. Producing
invalid versions in a field other systems will parse is how integration bugs start, so it
now emits proper build metadata and the constraint encodes the actual grammar rather than
being widened again next phase.

## Known limitations

- **No approved module exists**, and this repository will not contain one until a
  practitioner writes it. Everything downstream of that is built and tested.
- **The kiosk shell does not yet walk a patient through selection and intake.** The
  screens, the engine and the API all exist and are tested; the journey wiring them
  together is the remaining piece, along with the demographics form still outstanding
  from Phase 5.
- **`compose` handles one module.** Complaint-specific branches, which the phase structure
  lists alongside modules, are not implemented — they need authored content too.
- **No follow-up delta yet.** Phase 12.
- **The approval gate is a service, not a workflow.** It says whether a release _may_ be
  published; the console that collects the approvals, runs the canary and performs the
  rollback is Phase 14.

## Exit criteria

| Criterion                                   | Status                                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| One AYUSH module is live and approved       | **Not met, and not meetable here** — requires a registered practitioner. The gate that will enforce it is built and tested. |
| Other modules are configuration-disabled    | Verified — a system without an approved module is not offered at all                                                        |
| Module answers are structured and versioned | Verified — both core and module versions on every answer                                                                    |
| No LLM-generated clinical protocol is used  | Verified — six skeletons, zero questions, asserted by test                                                                  |
