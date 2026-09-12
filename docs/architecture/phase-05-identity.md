# Phase 5 — Identity and patient matching

## Objective

Safe new-registration and existing-patient identification. This is the phase where a
wrong answer puts one person's history in front of another person's doctor, so the
controls are built so that being unsure produces a refusal, never a guess.

## What was built

| Endpoint                       | Purpose                                            |
| ------------------------------ | -------------------------------------------------- |
| `POST /v1/identity/otp`        | Send a one-time code                               |
| `POST /v1/identity/otp/verify` | Verify it; attempts limited, then locked           |
| `POST /v1/identity/resolve`    | Resolve a patient, or refuse                       |
| `POST /v1/identity/confirm`    | The patient confirms the masked details are theirs |
| `POST /v1/identity/register`   | Promote the provisional record consent created     |

Migration `0008` (`otp_verification`, `identity_attempt`), an `SmsAdapter` with a sandbox
and an unconfigured implementation, and the Flutter identity screens plus a kiosk keypad.

## Matching strength

| Method           | Strength  | Releases a record?                      |
| ---------------- | --------- | --------------------------------------- |
| UHID + encounter | STRONGEST | Yes                                     |
| Appointment QR   | STRONG    | Needs a HIS adapter — currently refuses |
| ABHA verified    | STRONG    | Feature-flagged off — currently refuses |
| Mobile OTP       | MODERATE  | **No**                                  |
| Name alone       | —         | Not expressible in the contract         |

**Mobile OTP alone never releases a record.** It proves possession of a handset, not
identity, and family phones are shared. Narrowing by date of birth removes the _ambiguity_
but does not raise the _evidence_ — a date of birth is not a secret — so the refusal
changes reason, not outcome. A patient on a shared phone is directed to the counter.

**Name-only lookup is not merely unsupported.** There is no name field on any variant of
the resolve request, so the query cannot be constructed at all.

## Decisions and trade-offs

**Every non-single, non-confident outcome refuses, and all refusals look identical.** Not
found, ambiguous, too weak, expired code and locked code produce one neutral message.
Telling a patient "we found two people with this number" would disclose that a second
person is registered here.

**Resolution and confirmation are separate steps.** The system proposes; the person
standing at the kiosk decides. Without it, a UHID typed one digit wrong would silently
open a stranger's record.

**Unconfirmed candidates are held in memory, never persisted.** An unconfirmed identity is
not a fact about anyone, and writing it would create a durable record associating a kiosk
with someone who may not be the person standing there. They expire in three minutes.

**OTP responses are identical for registered and unregistered numbers.** Otherwise the
kiosk becomes a way to test which mobile numbers belong to patients of this hospital.

**Codes are stored as HMAC-SHA256, never plaintext**, compared in constant time, with a
key id so the secret can be rotated without invalidating codes in flight. A database dump
must not hand an attacker live one-time codes.

**Registration promotes the provisional patient rather than inserting.** The consent
artefact is already bound to the provisional id; a second row would leave the real patient
with no consent and the consent pointing at an empty record. Possible duplicates are
flagged for staff, never merged — refusing to register someone whose relative shares their
phone would deny care, and merging on a guess is the wrong-patient failure itself.

**The kiosk uses its own keypad, not the Android soft keyboard**, which can expose
clipboard history and voice input, has keys far below the touch floor on a wall-mounted
screen, and can be dismissed leaving a patient stuck.

## Two defects the tests and walkthrough caught

**The OTP attempt counter never persisted.** The increment ran inside the same serializable
transaction that then threw the refusal, so it rolled back with it. Every wrong guess
looked like the first, the lock never engaged, and a six-digit code was a few thousand
guesses from a determined caller. The transaction now _returns_ a verdict and the refusal
is raised after it commits. This was a live authentication bypass, caught by the lockout
test rather than by review.

**Confirmations were never recorded.** `confirm` updated `identity_attempt` by correlation
id, but resolve and confirm are separate HTTP requests, each generating its own — so the
update matched nothing and every confirmed match stayed recorded as unconfirmed. The
candidate now carries its attempt id. Found by reading the audit table during the manual
walkthrough, not by a test; a test now pins it.

## Known limitations

- Flutter now compiles and its 150 tests pass; see `docs/architecture/flutter-verification.md`
  for the four defects that surfaced the first time it was actually run.
- **Appointment QR and ABHA both refuse.** Each needs an external adapter the hospital must
  supply — an appointment QR is signed by the HIS, ABHA requires ABDM onboarding. Returning
  nothing is the honest behaviour; a stub that resolved a patient would be inventing identity.
- **No real SMS gateway.** The sandbox writes the message to the log, which is exactly why
  production refuses to boot with it. A real gateway needs hospital credentials, a sender
  ID and DLT registration in India.
- **The demographic registration form is not built.** `POST /v1/identity/register` works
  and is tested; the kiosk screen that collects name, sex and date of birth is deferred to
  Phase 8, where the master prompt specifies the demographics workflow (§11).
- **Candidates live in process memory.** Fine for a single API instance; a multi-instance
  deployment needs them in Redis, or a patient could be bounced to a node that has never
  heard of their candidate handle.
- **No OTP expiry scheduler.** `expireLapsed()` is implemented and tested; verification
  checks expiry itself, so this is tidiness rather than correctness.
- **Rate limiting is per mobile number**, not per device or per source. A kiosk hammering
  many different numbers is not yet throttled.

## Exit criteria

| Criterion                                        | Status                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| Wrong-patient tests pass                         | Verified — ambiguous, weak, cross-hospital and provisional matches all refuse |
| Name-only search cannot reveal records           | Verified — not expressible in the contract                                    |
| Duplicate candidates route to a controlled state | Verified — `IDENTITY_AMBIGUOUS`, neutral message, count recorded              |
| UHID and mobile flows work end to end            | Verified against PostgreSQL                                                   |
| ABHA is feature-flagged and adapter-based        | Verified — refuses while off, recorded as `METHOD_DISABLED`                   |
