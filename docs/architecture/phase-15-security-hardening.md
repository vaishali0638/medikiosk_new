# Phase 15 — Security, privacy and compliance hardening

Most of this phase's control list was already built, phase by phase, as each feature needed
it. The work here was to **attack it**, close what the attacks and the audit exposed, and
write down what a hospital's security reviewer will ask for.

## The attacks, actually attempted

`test/security.int-spec.ts` works through the specification's security-test list as
adversarial tests: each tries to do something the system must refuse and passes only when the
refusal holds. Several duplicate a property asserted elsewhere from the feature side, which
is deliberate — a property proven by the code that implements it is proven by its author's
assumptions; the same property attacked from outside is proven against them.

| Attack                 | Result                                                                            |
| ---------------------- | --------------------------------------------------------------------------------- |
| Authentication bypass  | Repelled — no credential, forged token, revoked, expired, disabled account        |
| Role escalation        | Repelled — including a role claimed in a request header                           |
| Wrong-patient access   | Repelled — department, facility, and a kiosk reaching across hospitals            |
| SQL injection          | Repelled — path and body; the tables are still there afterwards                   |
| XSS payloads           | Stored inert; returned as JSON, never interpolated into a document                |
| Audit tampering        | UPDATE and DELETE both silently discarded by database rule                        |
| Session leakage        | Repelled — one kiosk session cannot act on another's visit                        |
| Document-link forgery  | Repelled — tampered signature, extended expiry, and re-pointed to another user    |
| Export forgery         | Repelled — unconfirmed records refused; a forged verified label refused by the DB |
| Information disclosure | No stack traces, SQL or constraint names; identical bodies for probeable failures |
| Rate-limit bypass      | Newly possible to test, because rate limiting newly exists                        |

**25 of the 28 attacks were already repelled on the first run.** Of the three that failed,
two failed because my own constraints stopped the _test setup_ — `staff_session_expires_after_issue`
refused a backdated expiry, and the legal-hold constraints refused a malformed fixture — and
the third was a wrong assumption in the test (reading the kiosk config writes no audit event,
correctly, so there was nothing to tamper with).

## What was actually missing: rate limiting

`RATE_LIMITED` existed as an error code and only the OTP service enforced anything. Nothing
limited staff sign-in, and nothing limited a kiosk walking through a list of mobile numbers.

Counters live in the database, not in memory. **A per-process counter is not a rate limit on
a deployment with two instances behind a load balancer** — the attacker gets N attempts per
instance and the limit quietly doubles. At kiosk volumes the write cost is irrelevant and the
shared count is exact.

The subject is hashed, so a leaked backup of the bucket table is not a list of which mobile
numbers tried to check in and when. There is a test asserting the number does not appear.

**Windows are fixed, not sliding**, which lets an attacker send 2N across a boundary. That is
a real weakness of the approach and is accepted: the alternative needs a sorted set per
subject or a leaky bucket with timers, and neither is worth it when the limits already sit
far below what any script needs to be useful.

**A duplicate limiter was removed rather than added.** The first version of this added a
per-number OTP bucket — and `OtpService.assertSendRateOk` has limited sends per mobile since
Phase 5. Two limiters on one thing means the effective limit is the smaller of two numbers in
two files, which is how a limit gets loosened by someone who only found one of them. What
survives is the per-**device** bucket, which is the case the existing check cannot see: one
kiosk walking a list of numbers, each of them individually under its limit.

## Retention and legal hold

Two rules, and the second always beats the first:

1. Data past the hospital's **approved** retention period for its kind is eligible. No policy
   means nothing is eligible — an absent policy is an unanswered question, not permission to
   delete. `retention_policy` records who approved it and when, because a retention period
   nobody signed off is a number an engineer chose, and deleting a patient's records on that
   basis is not defensible.
2. A live **legal hold** stops deletion outright. Keeping data slightly too long is a privacy
   fault; destroying it under a hold is spoliation of evidence, and the two are not
   comparable. A hold must name a patient or an encounter — one that names neither holds
   nothing while looking like a control — and must give a reason of at least ten characters.

`plan()` reports what _would_ be deleted without deleting it, so a purge can be checked
before it runs.

**Nothing here touches `audit_event`.** The record of who did what to a patient's record
outlives the clinical data it describes: a deletion nobody can prove happened is not a
deletion anybody can defend.

## Documents written

- `docs/security/access-matrix.md` — who may do what, and **where each rule is enforced**.
  Every row names the guard, service or database constraint that makes it true, so the
  matrix can be checked rather than believed. Four of the rules are database constraints and
  survive a refactor that deletes the code above them.
- `docs/runbooks/breach-response.md` — written for someone reading it at 2am who has not read
  it before. Opens by saying not to delete anything, and to place a legal hold first.
- `docs/runbooks/backup-and-restore.md` — the restore drill, including the step people forget:
  documents are encrypted before they reach the object store, so a database and object-store
  backup restored without `OBJECT_ENCRYPTION_KEY` gives you a complete-looking system in which
  no document opens.

## Tests

| Suite                       | Count |
| --------------------------- | ----- |
| `test/security.int-spec.ts` | 41    |

Full suites: **154 backend unit, 382 backend integration, 240 Flutter**. `verify` clean.

## What this phase does not close

Six of the specification's controls are not code in this repository, and calling them done
would be false:

- **Staff SSO** is a sandbox provider. OIDC/SAML against a hospital IdP is unbuilt.
- **Kiosk device certificates.** `kiosk_device.cert_fingerprint` exists and is unused. A
  device is identified today by a code in a header — a shared secret visible to anyone who
  can read the device's configuration. mTLS is the intended control and is not built.
- **TLS in transit** is a deployment concern; there is no ingress configuration here.
- **Vault/KMS key management.** Keys come from environment variables. Key _ids_ are recorded
  against every encrypted document and signed token, so rotation is possible — but the
  storage is env, not a key manager.
- **Backup and restore is a documented drill, not an automated job.** There is no backup
  scheduling in this repository to point at.
- **Penetration test, approved access matrix, incident-response exercise.** These are
  organisational activities. The matrix is written and the runbook exists; a hospital signing
  them off and rehearsing them is Phase 0 work that no amount of code substitutes for.

**FHIR R4 mapping** and **ABDM onboarding** are also on the phase's list and are untouched;
the export adapter passes the internal record shape.

## Exit criteria

| Criterion                       | Status                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Critical vulnerabilities closed | No vulnerability found by the 41 attacks. Rate limiting added; the known gaps are listed above         |
| Penetration test completed      | **Not met** — an external exercise. The adversarial suite is a floor, not a substitute                 |
| Access matrix approved          | **Written, not approved** — approval is the hospital's                                                 |
| Restore test passes             | **Not met as an automated test** — documented as a drill with explicit verification queries            |
| Incident response tested        | **Not met** — the runbook exists; rehearsing it is organisational                                      |
| Kiosk wipe verified             | Verified since Phase 3 — wipe on exit, timeout, completion and error, with a session-level attestation |
