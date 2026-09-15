# Status and API inventory

Verified on 15 September 2026 by probing a running instance, not by reading route
declarations. Every figure below came from a command whose output is reproducible.

## Is every API working?

**All 63 mapped routes respond.** They were probed with an empty body and a kiosk device
header; the status each returned is the status that shape of request deserves.

| Status          | Routes | Meaning                                                                                                                             |
| --------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 200 / 201       | 5      | Answered the probe outright: `/health`, `/health/ready`, `/v1/kiosk/config`, `/v1/intakes/ayush-systems`, `POST /v1/kiosk/sessions` |
| 400 / 422 / 410 | 40     | Rejected an empty or stale payload. Correct — the probe sent `{}`                                                                   |
| 401 / 403       | 18     | Refused an unauthenticated caller. Correct                                                                                          |
| 404             | 0      | Every declared route is mounted                                                                                                     |
| 5xx             | **0**  | —                                                                                                                                   |

Reproduce with `bash scripts/probe-api.sh` against a running stack.

Five routes returned **500** before this pass and no longer do — see below.

## What each API group is for

Sixty-three routes in eleven groups. Which client calls which, and why it exists.

| Group                      | Routes | Called by                       | Purpose                                                                                                                                                                                                              |
| -------------------------- | ------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/health`, `/health/ready` | 2      | Load balancer, kiosk at startup | Liveness, and whether dependencies are reachable. Outside the `/v1` prefix so a probe never breaks on a version bump                                                                                                 |
| `/v1/kiosk/*`              | 7      | Kiosk                           | Device config (languages, departments, feature flags), session lifecycle, language selection, activity heartbeat, walk-in visit, session end with wipe attestation                                                   |
| `/v1/consents/*`           | 4      | Kiosk                           | The published notice in the patient's language, recording a grant or refusal, withdrawal. Consent is a first-class record, not a boolean                                                                             |
| `/v1/identity/*`           | 5      | Kiosk                           | OTP send and verify, UHID and duplicate resolution, confirmation, new-patient registration. The response is identical for a registered and unregistered number, so the kiosk cannot be used to test who is a patient |
| `/v1/intakes/*`            | 5      | Kiosk                           | The questionnaire engine: next question by deterministic branching, answer submission with provenance, one question re-served for editing, AYUSH systems for the department                                          |
| `/v1/precheckins/*`        | 11     | Kiosk + patient PWA             | Pre-check-in create and submit, signed QR issue, documents, patient review, follow-up delta, the clinical draft                                                                                                      |
| `/v1/arrival/*`            | 4      | Kiosk                           | QR validation, arrival confirmation, HIS token request, status. Where replay, wrong-facility and expiry are refused                                                                                                  |
| `/v1/patient/*`            | 5      | Patient PWA                     | The phone-side equivalents: hospital lookup, OTP, consent, notice. Separate from the kiosk routes because the trust context differs                                                                                  |
| `/v1/doctor/*`             | 7      | Doctor console                  | Staff session, worklist, one encounter with its draft and documents, clinician verification, EMR export. Verification is the only route that turns a draft into a record                                             |
| `/v1/governance/*`         | 6      | Governance console              | Content releases: draft, approve, transition, history, and which content kinds are live with nothing published                                                                                                       |
| `/v1/metrics`, `/v1/ops/*` | 5      | Prometheus, operations          | Metrics in Prometheus text format, alert evaluation, device events, reconciliation queue and sweep                                                                                                                   |
| `/docs`, `/docs-json`      | 2      | Anyone                          | OpenAPI, generated from the same Zod schemas that validate requests, so it cannot drift                                                                                                                              |

Three things worth noticing about the shape:

**The kiosk and the phone have separate routes** for the same conceptual actions. A kiosk is
a shared device in a public corridor identified by a header; a phone is personal and
authenticated by OTP. Sharing the routes would mean sharing the trust assumptions.

**`/v1/doctor/encounters/:id/confirm` is the only route in the system that produces a
clinical record.** Everything upstream produces candidates, drafts and patient-reported
statements. That asymmetry is the design.

**Nothing lets a client write an audit event.** `audit_event` has append-only rules at the
database level and is written only as a side effect of the action being audited.

## What the backend is

A NestJS 10 modular monolith over PostgreSQL 16, with Kysely as a typed SQL builder. No
ORM: every query is SQL the author wrote and can read in a plan.

|                    |                                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modules            | 19 — arrival, audit, consent, db, documents, followup, governance, health, identity, intake, kiosk, observability, ops, patient-channel, precheckin, security, sms, staff, summary |
| Routes             | 63                                                                                                                                                                                 |
| Migrations         | 24, raw SQL, each exercised up → down → up                                                                                                                                         |
| Tables             | 34                                                                                                                                                                                 |
| State machines     | 5, with graph-cut tests proving gates cannot be bypassed                                                                                                                           |
| Integration tests  | 418 against real PostgreSQL                                                                                                                                                        |
| Backend unit tests | 165                                                                                                                                                                                |

The load-bearing decision is that **safety properties are database constraints, not
application checks**. One issued token per visit, one live QR per visit, one published
version per content key, no session ending without a wipe attestation, append-only audit —
all enforced by indexes, constraints and rules. Application code can be wrong; a unique
index cannot be talked out of it.

Transactions that change consent, arrival or token state run SERIALIZABLE with
conflict-only retry. The job queue uses `FOR UPDATE SKIP LOCKED`. Documents live in object
storage; PostgreSQL holds the key, a SHA-256 taken over the plaintext before encryption,
and metadata. QR tokens are Ed25519 over a one-time nonce, deliberately not JWS.

## Implemented

| Area                                                             | State                                                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Patient identity — mobile OTP, UHID, duplicate resolution        | Production implementation                                                           |
| One-time codes                                                   | CSPRNG, HMAC-stored, 5-minute TTL, 5 verify attempts, 3 sends per number per 15 min |
| Consent as a first-class record                                  | Production; state machine, versioned notice, withdrawal                             |
| Pre-check-in and signed QR                                       | Production; replay, wrong-facility and expiry all refused                           |
| Arrival and HIS token                                            | Production against a **sandbox** HIS adapter; never issues a second token           |
| Questionnaire engine, branching, AYUSH module composition        | Production — with no clinical content in it                                         |
| Document capture, encryption, OCR extraction                     | Production; OCR adapter is a stub                                                   |
| Clinical draft generation                                        | Production safety gate around a **placeholder** generator                           |
| Doctor worklist, verification, export                            | Production                                                                          |
| Governance registry — draft, approve, canary, publish, roll back | Production                                                                          |
| Audit, retention, legal hold, break-glass                        | Production                                                                          |
| Observability — metrics, alerts, device events                   | Production                                                                          |
| Kiosk client                                                     | Production; lock-task, FLAG_SECURE, secure wipe, 274 tests                          |
| Languages                                                        | 23 registered, 14 fully translated, **0 reviewed by a speaker**                     |
| Spoken guidance                                                  | Android and macOS handlers; **never heard on a real device**                        |
| SMS                                                              | Sandbox (logs the code). An HTTP gateway adapter now exists — see below             |

## SMS: what changed and what you still need

`SMS_ADAPTER` now takes three values.

- `sandbox` (default) — writes the message to the API log. What you have been using; it is
  why no SMS arrived. `assertProductionAdapters` refuses to boot production with it,
  because a production log holding live one-time codes is a credential store in disguise.
- `http` — **new.** A real gateway over JSON POST, provider-agnostic because which gateway
  a government hospital uses is a procurement decision. Works with MSG91, Gupshup, Kaleyra
  and anything else accepting an API key header.
- `unconfigured` — throws rather than silently succeeding.

```bash
SMS_ADAPTER=http
SMS_API_URL=https://control.msg91.com/api/v5/flow
SMS_API_KEY=<your key>
SMS_AUTH_HEADER=authkey        # Authorization for most gateways; authkey for MSG91
SMS_SENDER_ID=AYUSHK           # six alphabetic characters, registered
SMS_DLT_TEMPLATE_ID=<your id>
```

The adapter will not log the message body or the full number, will not retry, and reports
`delivered: false` on any non-2xx, timeout or transport error rather than claiming a send
it did not observe. Seven unit tests cover those paths.

**It has never sent a message.** Three things must exist before it can, and none of them
is code:

1. **An account with an Indian SMS provider.**
2. **A registered sender ID.** Six alphabetic characters, approved by the operator.
3. **A DLT-approved template.** Under TRAI's Distributed Ledger Technology regime every
   transactional SMS must match a template registered with the operator, word for word.

The third is the one that catches people. An unregistered template or header is dropped by
the **operator**, not the gateway — so the gateway returns 200, the adapter reports success,
and the message never arrives. That failure is invisible from here, which is why
`SMS_SENDER_ID` and `SMS_DLT_TEMPLATE_ID` are required rather than optional.

## Fixed in this pass

- **Five ops routes returned 500 instead of 401.** An unset `OPS_API_KEY` threw
  `INTERNAL_ERROR`. Refusing was right — these must never default open — but Prometheus
  scrapes `/v1/metrics`, so a 500 read as the API being down: a false outage alert from the
  one component whose job is to notice real ones. It also told an unauthenticated caller
  that the ops API was unconfigured. A wrong key returned 400, which was simply the wrong
  word. Both are now 401, with identical bodies so neither state is disclosed.
- **One mistyped OTP digit ended the journey.** Every verify failure landed on "we could
  not confirm your details — speak to the counter", which made the five attempts the server
  grants unreachable and the screen's own attempts-remaining display dead code. A plain
  refusal now keeps the patient on the keypad; `RATE_LIMITED` still ends the attempt. The
  property the old behaviour existed to protect — never disclosing _which_ failure occurred
  — is preserved and still asserted.

## Pending, and why

**Blocking a pilot.** None of these is a code change.

- **No clinical content exists in any language, English included.** Consent notices and
  questionnaires ship as `0.1.0-placeholder` with `NOT_A_REAL_APPROVAL` against them, and
  the six AYUSH modules contain zero questions. This has been the largest blocker since
  Phase 17 and remains so.
- **Phase 0 — clinical governance sign-off — is untouched.** No practitioner has authored
  or reviewed anything.
- **No shell translation has been read by a speaker of the language.** Fourteen languages,
  fourteen reviewers needed.

**Needs a hospital's own procurement or infrastructure.**

- Real SMS gateway (above). Real HIS or queue system — the adapter interface is built, the
  sandbox stands in. Staff SSO — sandbox only. Device certificates for mTLS —
  `cert_fingerprint` exists and is unused. Keys in environment variables rather than a KMS.
  No TLS configuration, no alert delivery, no Grafana dashboards.

**Engineering not yet done.**

- Nine of 23 languages untranslated; no bundled fonts, so Manipuri and Santali render as
  empty boxes. AI worker is a placeholder. OCR adapter is a stub. No CD pipeline, image
  signing or SBOM. No load or soak testing. Spoken guidance has never been heard on a
  physical device. `doctor_web` and `governance_web` have no tests of their own. Three
  hospital-facing guides unwritten.

`npm run lang:coverage` and `tools/src/production-readiness.ts` report these as data rather
than prose. `evaluateReadiness()` always returns `ready: false`, and deliberately is not a
computation that could one day return true.
