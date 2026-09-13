# Phase 17 — Full testing and pilot

Two halves that could not be more different. The test matrix is buildable and was mostly
already built. **The pilot is not something a repository can contain** — it needs three
kiosks in a corridor, a real AYUSH department, real patients, and clinical content a
practitioner has approved.

## The matrix, made executable

The specification names 45 scenarios across seven categories.
`tools/src/pilot-coverage.ts` lists every one of them, mapped to the test that covers it —
and `pilot-coverage.spec.ts` checks the mapping against the test names actually present in
the repository.

The point is not the count. It is that **a gap has to be declared**, with a reason longer
than a sentence, rather than simply being absent. And a scenario whose test is later renamed
or deleted fails here, which is the only way a matrix like this stays true after the first
week. A coverage document that was accurate once and then drifted is worse than none,
because it reads as assurance.

The same shape as the alert-runbook check in Phase 16, and it did the same job: the first
run reported 17 scenarios with no matching test. Eight of those turned out to exist under
different names — the accessibility cases live in Flutter widget tests, the forbidden-option
scan in `tools`. **Nine were genuinely missing.** They are now written.

| Category          | Scenarios | Covered | Declared gaps |
| ----------------- | --------- | ------- | ------------- |
| Workflow          | 8         | 8       | —             |
| QR and security   | 9         | 9       | —             |
| Identity          | 7         | 7       | —             |
| HIS and queue     | 7         | 7       | —             |
| Clinical safety   | 6         | 5       | 1             |
| Accessibility     | 8         | 6       | 2             |
| Forbidden options | 1         | 1       | —             |

## The finding: a UHID resolved with any date of birth

Writing the specification's "Wrong DOB" case exposed that the control did not exist.

`UHID_AND_ENCOUNTER` is `STRONGEST` — strong enough to release a patient's whole record.
The schema said the birth date was **"Required — UHIDs are printed on paper"**, the field
was `.optional()`, and the value was only ever used to _disambiguate multiple matches_:
`narrowByBirth` returned early whenever there was one candidate, which for a UHID lookup is
every time. So a UHID picked up off a discarded slip resolved with any date of birth the
caller invented, or none at all.

Three things disagreed — the comment, the schema and the behaviour — and the weakest won.
Now the birth date is required for a UHID lookup and is **verified** against the record: the
card is possession, the birth date is knowledge, and one alone is not identity. A patient who
does not know theirs goes to the counter, the same route as a patient with only a phone.

## And underneath it, a timezone bug

Fixing that immediately failed on a _correct_ date. node-postgres turns a `date` column into
a `Date` at **local** midnight, so comparing with `toISOString().slice(0, 10)` shifts it
backwards by the UTC offset. In India, `1975-01-01` read back as `1974-12-31` — **every**
birth date was off by one.

That comparison was written in Phase 5 and had been wrong for twelve phases, invisible
because the only code path that reached it skipped it. There is now a test that asserts both
the correct date matches and the day before does not.

## The other eight tests written

- **Exit from every screen** — 22 real kiosk screens built directly and checked for a way
  out, rather than reached by walking the journey. Several need a scanner, a printer or a
  network failure to reach, and a screen that can only be tested by reproducing a fault is a
  screen that stops being tested. Two screens deliberately offer none, and the test asserts
  that too: the idle home screen _is_ the exited state, and an expired session was already
  wiped.
- **Wrong branch** — a hospital with two sites shares a hospital id, so binding only to the
  hospital would let a code issued for the main building work at a satellite clinic.
- **Wrong department** — the department is in the signed payload, so a code cannot be taken
  to another queue and counted in it.
- **Patient mismatch** — `identityConfirmed` is a literal `true`, so "no" and "field omitted"
  are both refusals and neither can be defaulted into a yes.
- **No mobile** — the kiosk offers no phone-less registration, because "Register without
  phone" is on the forbidden list: a route that skips verification registers anybody as
  anybody. The test pins the control underneath — registration is impossible without a
  verification the OTP service accepts.
- **Multiple visits** — one-visit-per-session must not become one-visit-per-patient.
- **No-show** — a visit opened and abandoned leaves no token and no encounter, because an
  encounter is a consultation that happened.
- **Sensitive question refusal** — "I prefer to tell the doctor" is stored as an answer, not
  an absence. A doctor reading silence where the patient meant "ask me in the room" is the
  failure this prevents.

## The three declared gaps

- **Internal red-flag status.** Red-flag rules are not built. The specification requires
  hospital-approved deterministic rules behind `FEATURE_RED_FLAGS`; that is Phase 0 content
  nobody has authored, the flag defaults off, and there is no rule to test.
- **Noisy environment.** Needs voice intake and real hardware in a real OPD. ASR is not
  built, and a microphone array in a corridor cannot be simulated in a widget test.
- **Caregiver operation.** A relative operating the kiosk for a patient is indistinguishable
  from the patient doing it, by design — the system never asks who is holding the screen.
  Whether that is right is a question for observation during the pilot, not a test.

## The pilot itself

**Not started, and not startable from here.** Each criterion, honestly:

| Criterion                                    | Status                                                                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| At least three kiosks operate reliably       | **Blocked** — needs three provisioned Android devices in a hospital corridor                                                                                                  |
| One AYUSH department completes real journeys | **Blocked** — needs a department, real patients, and Phase 0 sign-off                                                                                                         |
| Patient review works                         | Built and tested; unobserved by a real patient                                                                                                                                |
| Final token comes from HIS                   | Built against a sandbox adapter. A real HIS integration is hospital-specific work                                                                                             |
| Duplicate tokens are zero                    | Enforced at four layers and tested under concurrency; unmeasured in production                                                                                                |
| No critical privacy or security incident     | 41 adversarial tests pass; a pilot is the first real test of this                                                                                                             |
| Doctor can review and confirm                | Built, tested, and driven in a browser                                                                                                                                        |
| Clinical governance approves live content    | **Blocked, and the most important one** — no AYUSH module exists, the consent notices and questionnaire are labelled placeholders, and no practitioner has reviewed any of it |

The last row is not a scheduling problem. **A pilot with real patients cannot run on
placeholder consent wording**, and no amount of engineering substitutes for a practitioner
authoring and signing the clinical content. That is Phase 0, it was never started, and it
gates this phase rather than the other way round.

## Tests

Full suites after this phase: **158 backend unit, 412 backend integration, 243 Flutter, 11
tools**. `verify` and `flutter analyze` clean.

## Known limitations

- **No load or soak testing.** The specification's categories do not list it and none is
  written. A busy OPD morning is the obvious thing a pilot would surface.
- **No failure-injection harness.** HIS timeouts and uncertain outcomes are tested through a
  scripted adapter, not by killing a dependency mid-request.
- **The web consoles still have no tests of their own**, covered only by the browser
  walkthrough in the previous commit.
- **Accessibility is tested structurally, not with people.** Touch targets, contrast ratios,
  text scaling and semantics are asserted; whether an elderly patient with poor eyesight can
  actually complete an intake is a question only observation answers.
