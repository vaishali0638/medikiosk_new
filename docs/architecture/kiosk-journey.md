# The kiosk journey

Phases 5 and 8 through 11 each built a set of screens, tested them, and left them
unreachable. Two of the three buttons on the home screen were literally
`onNewRegistration: null`. This pass wired the journey together and built the pieces that
were missing once the steps had to connect to each other.

## The three journeys

```
                     ┌─ Check in with Mobile QR ─→ scan → confirm → what changed → token
home → language → ───┼─ New Registration ────────┐
                     └─ Existing Patient ────────┤
                                                 ↓
                     consent → identity → [demographics] → [department] → [AYUSH]
                                → interview → documents → review → submit → token
```

The mobile-QR path was already built (Phases 6 and 7) and is unchanged: that patient did
their intake at home, so the kiosk only confirms who they are and gets them a token.

The two kiosk-hosted journeys differ **only** in how identity is established — a new
patient has no record to match against — and converge from the department step onward.
Both go through language and consent _first_: asking someone to identify themselves before
telling them what the kiosk will do with their information is collecting an identifier
without consent.

## What had to be built

**A walk-in visit.** Every clinical surface downstream — intake, documents, review,
submission, draft — is keyed on a `pre_checkin`. A mobile patient has one; a walk-in has
nothing. `POST /v1/kiosk/sessions/{id}/visit` opens one, taking the patient **from the
session, never from the request body**: a client that could name the patient could open a
visit against anyone in the hospital. It is idempotent per session, because two visits for
one person at one kiosk means two intakes and eventually two tokens (migration `0017`, a
partial unique index on `kiosk_session_id`).

The same `pre_checkin` row type is used rather than a parallel "kiosk visit" concept. A
clinician should not be able to tell from the record which door the patient came through,
and a second table would mean every downstream query needed two branches — the kind of
duplication where one branch quietly stops getting the safety checks.

**A second route to `ARRIVAL_CONFIRMED`.** The pre-check-in machine was built around
`TOKEN_ISSUED` being reachable only through `ARRIVAL_CONFIRMED`, which was proven by a QR
scan consuming a single-use nonce. A walk-in never has a QR, and their presence is proven
by the fact that the whole intake just happened on this device — which is stronger, not
weaker.

`SUBMITTED → ARRIVAL_CONFIRMED` was added for them. On its own that edge would let a mobile
pre-check-in reach a token without ever being scanned, so the control is in
`confirmWalkInArrival`, which refuses any visit with no `kiosk_session_id`. There is a test
that tries exactly that abuse. A transition table says what order things may happen in; it
cannot say who is allowed to ask.

**The demographics form**, outstanding since Phase 5. Age in years rather than a date of
birth: many patients at a government OPD do not know their date of birth, and a date picker
that must be satisfied produces a confident, fabricated `01-01-1970` in the record. Email
is omitted entirely — optional in the specification, unused by this system, and asking for
a contact detail with no purpose is collecting personal data for its own sake.

**A department picker**, shown only when the hospital has more than one enabled department.
Most OPD kiosks stand outside exactly one, and a choice with one option is not a choice.

**A single-question endpoint**, so the review screen's Edit button can reopen one answer
without restarting the interview. It serves a question only if the branching still makes it
applicable: sending a patient back to a question they have branched away from would record
an answer against a path they are not on.

**A document camera interface**, defaulting to unavailable everywhere. The document screens
then correctly say documents cannot be added at this kiosk, which is true, rather than
offering a button that fails when pressed.

## One deviation from the specification's section order

The master prompt has documents (§12) before AYUSH selection (§13). The journey does AYUSH
first, because the AYUSH system determines the department, the department is needed to open
the visit, and a document has to attach to a visit. Documents immediately follow.

## The bug this exercise was for

`showDialog` was being called with the `KioskApp` State's `context` — which sits **above**
the `MaterialApp` that its own `build` creates, and therefore has no `Navigator` and no
`MaterialLocalizations`. The call threw, the exception was swallowed by the unawaited future
behind the tap, and so:

- **every Exit button on every screen silently did nothing**, and
- **the inactivity warning dialog never appeared**, meaning a patient got no warning before
  their session was wiped.

Both are specification requirements — "every active screen must show only the `Exit`
termination action", and the timeout warning is a session-security control. Neither was
caught by 227 passing tests, because the dialogs were tested in isolation with their own
host widget and the shell had no test that walked it.

Fixed with a `navigatorKey` on the `MaterialApp`, giving dialogs a context below it. There
is now a regression test that presses Exit on an ordinary screen and asserts the dialog
opens.

The walkthrough also found the kiosk was reading `code` from a config field the server
publishes as `departmentId`, and sending an OTP `purpose` of `IDENTITY_VERIFICATION` — not
one of the two values the contract allows, which are `NEW_REGISTRATION` and
`EXISTING_PATIENT_LOOKUP`, corresponding exactly to the two journeys.

## Verified end to end

Against `dist/main.js` on a fresh database, driving the exact sequence the shell performs:

```
config → session → language → consent notice → consent granted
 → OTP sent (******0011) → verified → registered → visit opened
 → session INTAKE_IN_PROGRESS → 17 questions answered → review (17 items)
 → reopened one answer → submitted → pre_checkin ARRIVAL_CONFIRMED
 → token AYU-0001, Ayurveda OPD, room 2
 → draft: 'Patient reports "Pain". Clinical diagnosis has not been provided.'
```

And in the Flutter shell, five widget tests covering both journeys to a token, the neutral
failure path, the Exit dialog, and the wipe.

## Known limitations

- **No document capture hardware.** The interface exists and defaults to unavailable, so
  the documents step renders honestly and is skipped in practice.
- **Possible-duplicate handling is a screen, not a flow.** `PossibleDuplicateScreen` is
  built and the register endpoint returns `possibleDuplicates`, but the shell does not yet
  route to it.
- **`pre_checkin.state` stops at `ARRIVAL_CONFIRMED` after a token is issued.** The
  authority for token state is the `token_request` row, which correctly reaches `ISSUED`.
  This is pre-existing Phase 7 behaviour and identical on both paths, but it means
  `TOKEN_REQUESTED` and `TOKEN_ISSUED` are unreachable states on the pre-check-in machine.
- **Voice intake is not wired.** Every answer is recorded as `TOUCH`.
- **Address is collected only if `addressRequired` is set**, and nothing sets it yet —
  hospital policy, per the specification.
