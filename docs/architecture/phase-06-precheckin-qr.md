# Phase 6 — Mobile pre-check-in and signed QR

## Objective

The complete home pre-check-in and hospital arrival flow, before any AI is involved.

## What was built

| Endpoint                               | Channel | Purpose                                            |
| -------------------------------------- | ------- | -------------------------------------------------- |
| `GET /v1/patient/hospital`             | patient | Hospital name and the languages a notice exists in |
| `GET /v1/patient/consents/notice`      | patient | The published notice                               |
| `POST /v1/patient/otp` · `/otp/verify` | patient | Prove possession of a mobile number                |
| `POST /v1/patient/consents`            | patient | Record a decision, captured as `MOBILE_PWA`        |
| `POST /v1/precheckins`                 | patient | Create against a live consent                      |
| `POST /v1/precheckins/{id}/submit`     | patient | Submit — only a submitted intake gets a QR         |
| `POST /v1/precheckins/{id}/qr`         | patient | Issue a signed, short-lived, single-use code       |
| `POST /v1/arrival/check-in`            | kiosk   | Validate a scanned QR                              |
| `POST /v1/arrival/{handle}/confirm`    | kiosk   | Confirm the visit and declare changes              |

Plus `QrTokenService`, migrations `0009` and `0010`, the kiosk scan/confirm/changed
screens wired into the shell, and the patient PWA.

## The QR token format

`mk1.<keyId>.<payload>.<signature>`, Ed25519, all base64url.

**Deliberately not JWS.** JWS carries the algorithm inside the token's own header, which
is the root of the `alg: none` and RS256→HS256 confusion attacks — the verifier ends up
asking the attacker how to check the attacker's signature. Here `mk1` pins Ed25519 for the
whole format, and a token that does not start with it is rejected before anything else is
read. Changing algorithm means a new prefix and a deliberate code change.

The payload carries eight fields and no medical data, asserted by test: pre-check-in id,
hospital, branch, department, visit window, expiry, nonce. The code is displayed on a
phone screen in a public waiting area and may be photographed by anyone standing nearby.

Retired public keys stay verifiable, so a key rotation does not strand a patient holding a
code on screen.

## Validation order, and why it is that order

```
signature → key known → expiry → claim shape        (nothing in the payload is trusted
                                                     until the signature checks out)
  → hospital → branch → department → visit window   (facility binding, BEFORE the nonce)
  → pre-check-in state → consent → no prior token
  → consume nonce                                   (atomic, and last)
```

Facility checks run **before** the nonce is spent, so a patient who scans at the wrong
building can still check in at the right one. The nonce is spent **last** and atomically,
so a replayed code fails even when everything else about the visit is valid.

The nonce is consumed on a successful scan rather than on confirmation. A code that stayed
live after being scanned would be replayable by anyone who photographed the screen; a
patient who scans and walks away can reissue from their phone.

## The arrival handle

A QR payload is signed, not encrypted — anyone who photographs it can base64-decode the
pre-check-in id. If that id were also the handle used to confirm the arrival and request a
token, a bystander could drive the rest of someone else's journey. The kiosk therefore
learns a fresh random handle only as the result of a successful scan, and it is spent on
confirmation.

## One neutral refusal

Seventeen distinct internal reasons (`NONCE_ALREADY_USED`, `WRONG_HOSPITAL`,
`QR_BAD_SIGNATURE`, …) all produce the same status, the same body, and the same screen.
The real reason reaches the audit log and nothing else. Distinguishing them on screen
would turn the kiosk into an oracle for probing stolen codes.

The kiosk's rejection screen offers Exit and nothing else. Re-issuing is offered on the
**patient's phone**, which is the only place it can safely happen — the kiosk cannot issue
codes, so a "Generate New QR" button there would send patients round a loop it cannot close.

## Test results

| Suite                                 | Count | Status  |
| ------------------------------------- | ----: | ------- |
| Backend unit                          |    89 | Passing |
| Backend integration (real PostgreSQL) |   167 | Passing |
| Flutter widget and unit               |   167 | Passing |

Ten simultaneous scans of one code: exactly one succeeds.

## A constraint the real flow disproved

Phase 2 wrote `(arrival_confirmed_at IS NULL) = (arrival_kiosk_id IS NULL)`, assuming a
patient arriving and confirming were one event. Building the flow showed they are two: the
code is scanned at a kiosk, masked details are shown, and only then does the patient
confirm. Between those moments the device is known and the confirmation is not. Migration
`0010` makes the constraint one-directional — a _confirmed_ arrival must still name its
kiosk — which also means an abandoned scan stays attributable.

## A translation defect the guard caught

The Hindi for "New diagnosis" was written as `नई पहचान`, which reads as "new identity";
the clinical term is `निदान`. The Phase 4 rule that shell strings contain no clinical
wording flagged it.

That rule needed rethinking rather than suppressing: Phase 6 introduces the first
patient-facing clinical _categories_ (the "what changed?" picker), and the master prompt
specifies those labels verbatim. `KioskStrings.clinicalVocabularyKeys` now declares them,
and the test asserts that any string containing clinical vocabulary appears on that list.
The guard's purpose is to stop clinical wording arriving unnoticed, not to pretend a kiosk
can avoid it. Everything on that list still needs a translation reviewer before pilot use.

## Known limitations

- **No camera implementation.** `QrScanner` is an interface with an honest
  `UnavailableQrScanner`; the Android platform channel has no native side yet, so the scan
  screen reports the camera as unavailable on every current build. Wiring a real scanner
  needs hardware to test against.
- **The PWA has no clinical intake.** Symptoms, history and document upload are Phases 8
  and 10. The mobile flow in the prompt lists them; they cannot exist before their phases.
- **The PWA does not use OTP yet.** The endpoints exist and are tested, but the current
  flow creates a consent without first verifying the mobile number — so a pre-check-in is
  bound to a number nobody has proven they hold. Acceptable while the kiosk re-identifies
  the patient on arrival; it must be closed before the PWA is used for anything the kiosk
  does not re-check.
- **A day-long visit window.** Until appointment scheduling is integrated, narrowing it
  arbitrarily would turn a late bus into a refused check-in.
- **No token yet.** Confirming an arrival completes the kiosk session; Phase 7 requests
  the hospital token from that point.
- **The signing key is ephemeral in development.** Codes stop verifying across a restart —
  loud, and better than a fallback key committed to the repository.

## Exit criteria

| Criterion                                  | Status                                                  |
| ------------------------------------------ | ------------------------------------------------------- |
| Mobile pre-check-in can be submitted       | Verified — API tested, and the PWA drives it end to end |
| QR is signed and short-lived               | Verified — Ed25519, 5-minute TTL                        |
| QR cannot be replayed                      | Verified — including ten concurrent scans               |
| QR is hospital- and department-bound       | Verified, and refused without burning the code          |
| Kiosk validates the QR                     | Verified against real PostgreSQL                        |
| Invalid QR reveals no clinical information | Verified — one identical body for every failure         |
| Exit securely terminates the kiosk session | Verified (Phase 3), and the scanner is released on wipe |
