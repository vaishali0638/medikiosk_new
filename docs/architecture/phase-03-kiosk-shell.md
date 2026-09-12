# Phase 3 — Kiosk shell and session security

## Objective

The physical kiosk application shell, navigation, session reset and locked-device
behaviour — with no clinical data yet.

## What was built

### Backend

| Endpoint                                | Purpose                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /v1/kiosk/config`                  | Languages, departments, AYUSH systems, feature flags, content versions, session timings |
| `POST /v1/kiosk/sessions`               | Start a session                                                                         |
| `POST /v1/kiosk/sessions/{id}/activity` | Reset the inactivity window                                                             |
| `POST /v1/kiosk/sessions/{id}/language` | Record the selected language                                                            |
| `POST /v1/kiosk/sessions/{id}/end`      | End a session, with a wipe attestation                                                  |

Plus `KioskDeviceGuard`, `KioskSessionRepository`, and a global `DomainExceptionFilter`.

### Flutter

Seven screens — home, language, session expired, error, network unavailable, startup, and
the exit and timeout dialogs — over a session manager, a secure wipe, a typed API client
and a lock-task platform channel.

### Android

`MainActivity` (lock-task, `FLAG_SECURE`, inert Back), a device-admin receiver, a `HOME`
intent filter so a reboot returns to the kiosk, and backup rules that keep kiosk data off
cloud backup and device-to-device transfer.

## Test results

| Suite                                 |       Count | Status                          |
| ------------------------------------- | ----------: | ------------------------------- |
| Backend unit                          |          67 | Passing                         |
| Backend integration (real PostgreSQL) |          85 | Passing                         |
| Flutter widget and unit               | ~95 written | **Not run** — SDK not installed |

## Decisions and trade-offs

**The wipe attestation is a `z.literal(true)`.** A client cannot end a session without
claiming it wiped, and if the local wipe failed the client withholds the call entirely.
The server then leaves the session open for its abandoned-session sweep. A session
recorded as cleanly closed while data remains on the device is worse than one left open in
the audit log, because the first is invisible and the second is not.

**The server sweeps abandoned sessions too.** The client has its own inactivity timer, but
a kiosk that crashed or lost power never runs it. `expireAbandoned()` is what actually
guarantees no session stays open indefinitely.

**Three lock-down signals, never collapsed into one boolean.** Immersive mode, lock-task
mode and device-owner provisioning are different things and fail independently. The shell
shows a staff banner unless all three hold, and the fake used in tests reports `false` for
everything — a stub that claimed success would let an unlocked build pass a check the real
device has to earn.

**Every QR-style failure returns one identical body.** `DomainError` maps expired, used,
wrong-hospital and unknown to the same 422 and the same neutral message. Distinct statuses
would turn the kiosk into an oracle for probing stolen codes.

**Unknown and disabled kiosk devices are refused identically.** Otherwise device codes
could be enumerated by probing.

**Language filtering happens on the server.** Only clinically reviewed languages are
returned, and the language endpoint re-checks the tag against that list. The screen filters
again on `clinicallyReviewed` — belt and braces, because rendering an unreviewed
translation as approved clinical wording is a governance failure wherever it originates.

**Shell strings are separate from clinical content.** `KioskStrings` holds navigation and
system text only. A test asserts no shell string contains clinical wording, because
clinical text must come from the governance registry with named approval, not from a
developer editing a map.

**Unbuilt journeys render inert rather than hidden.** The three home options land in Phases
5–6. Keeping them visible preserves the specified layout for review; keeping them disabled
means nothing pretends to work. This is a Phase 3 build artefact, not a deployable state.

**`Listener`, not `GestureDetector`, for activity detection.** A `GestureDetector` competes
in the gesture arena and could swallow a patient's tap on a button.

## Two defects this phase caught

### NestJS DI silently broken by the dev runner

`npm run start:dev` used `tsx`, which compiles with esbuild — and esbuild does not support
`emitDecoratorMetadata`. NestJS resolves constructor dependencies from exactly that
metadata, so every controller with injected dependencies booted with `undefined` for each
of them and returned 500. Nothing caught it: unit and integration tests run under ts-jest,
which does emit the metadata, and the compiled Docker path uses `tsc`, which also does.
The broken artifact was the one a developer runs locally.

The underlying lesson is that whether this metadata exists is a property of the compiler,
not of the source, so testing the source proves nothing about the artifact. `start:dev`
now uses `ts-node`, and CI runs `npm run smoke`, which boots `dist/main.js` — the exact
thing the Docker image runs — and probes a controller that has injected dependencies.

### A lint autofix erased a runtime dependency

The Phase 2 `lint:fix` run rewrote `import { AuditRepository }` to
`import { type AuditRepository }` in `consent.repository.ts`. NestJS resolves constructor
dependencies from `emitDecoratorMetadata`, which needs the class present as a **value** at
runtime, so this silently broke DI — invisible to the existing tests, which instantiate
repositories directly, and only surfaced when the HTTP integration test booted the real
container. `@typescript-eslint/consistent-type-imports` cannot see decorator metadata, so
it is now disabled for `services/core_api/src`.

## Known limitations

- **The Flutter code has never been compiled or run.** `flutter analyze` and `flutter test`
  have not been executed because the SDK is not installed on this machine. Roughly 95
  widget and unit tests are written and unverified. Treat the Dart in this phase as
  unreviewed until those two commands pass.
- **`android/` has no Gradle scaffolding.** `flutter create` must be run once, then the
  committed Android sources restored from git. The README and runbook both say so.
- **Lock-down is untested on hardware.** Every claim about lock-task mode, `FLAG_SECURE`
  and reboot behaviour is from the Android contract, not from a device. The runbook's
  pre-service checklist exists to verify them.
- **Device identification is not authentication.** The device header is not a secret.
  Phase 15 adds mutual-TLS certificates; `kiosk_device.cert_fingerprint` already exists.
- **No audio guidance yet.** The toggle records a preference; TTS is Phase 4.
- **The abandoned-session sweep has no scheduler.** `expireAbandoned()` is implemented and
  tested but nothing calls it periodically — that arrives with the job runner in Phase 16.
- **Only English and Hindi shell strings**, and they are developer-written. Reviewed
  translations arrive in Phase 4.

## Exit criteria

| Criterion                                      | Status                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| No prior data remains after Exit               | Verified server-side; client wipe unit-tested but not run            |
| No prior data remains after timeout            | Same                                                                 |
| No forbidden options appear                    | Verified — CI scan clean, and widget tests assert on rendered output |
| Kiosk cannot escape into Android settings      | **Not verified** — needs hardware                                    |
| Device reboot returns to the kiosk home screen | **Not verified** — needs hardware                                    |
