# Threat model

The specification's threat table (§27), worked through against what is actually built. Each
threat names the control, where it lives, and what remains open.

The system's shape follows from one observation: **the kiosk is the only part an attacker
can physically touch.** It stands unattended in a public corridor, all day. Almost every
decision below is downstream of treating it as hostile.

## Assets, in the order losing them would matter

1. **A patient's clinical record** — answers, documents, the draft a clinician reads.
2. **The integrity of a clinical record** — a wrong dose, an invented diagnosis, a record
   attached to the wrong person.
3. **Identity** — who a record belongs to.
4. **Consent** — the lawful basis for holding any of it.
5. **Queue position** — a token. Least valuable, most visible when wrong.

## Threats

| Threat                                   | Control                                                                                                                                                                                                                 | Where                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Wrong patient**                        | UHID plus a verified date of birth; mobile OTP alone is too weak to release a record; masked confirmation the patient must accept; no name-only lookup anywhere                                                         | `identity.service.ts`, `MINIMUM_RELEASE_STRENGTH`        |
| **QR replay**                            | Ed25519 signature, short expiry, single-use nonce consumed atomically, bound to hospital, branch and department                                                                                                         | `arrival.service.ts`, `qr_nonce`                         |
| **QR forgery**                           | Signed payload with a key id; retired public keys stay verifiable so rotation strands nobody                                                                                                                            | `qr-token.service.ts`                                    |
| **Kiosk theft or tampering**             | Lock-task mode, `FLAG_SECURE`, no navigation out, wipe on every exit path, provisioned device codes, session ends on the server                                                                                         | Phase 3, `kiosk-device.guard.ts`                         |
| **Residual data on a device**            | Wipe on exit, timeout, completion and error; a client-ended session cannot be recorded without attesting to it; server-expired sessions are counted and alerted because nothing attested                                | `secure_wipe.dart`, `kiosk_session_exit_is_wiped`        |
| **Malicious upload**                     | Magic-byte validation, size bound, malware scan, encrypt-then-store with the row written last; the scanner fails closed                                                                                                 | `file-validation.ts`, `document.service.ts`              |
| **Stolen database**                      | Documents are AES-256-GCM ciphertext; session tokens are stored as SHA-256; OTPs are HMAC'd; rate-limit subjects are hashed                                                                                             | Phases 10, 13, 15                                        |
| **AI hallucination**                     | A draft is never a record; grounding by allowlist so an invented condition fails whatever it is called; banned diagnostic and treatment language; a database constraint refusing CLINICIAN-VERIFIED without a clinician | `safety-validator.ts`, `clinical_summary_verified_label` |
| **OCR misreading**                       | Extraction is a candidate, terminal state `AWAITING_CLINICIAN_REVIEW`; every field labelled; no automatic write to medication, allergy or diagnosis                                                                     | Phase 10                                                 |
| **Unauthorised clinician access**        | Role, facility and department checked per record; break-glass needs a typed reason and lands in its own table; identical refusal whether absent, foreign or out-of-department                                           | `encounter-access.service.ts`                            |
| **Duplicate clinical record in the EMR** | Derived idempotency key, unique column, partial unique index, and an uncertain outcome that asks before retrying                                                                                                        | `export.service.ts`                                      |
| **Duplicate token**                      | Four layers, tested under concurrency                                                                                                                                                                                   | Phase 7                                                  |
| **Credential stuffing / SMS flooding**   | Database-backed rate limits per credential, per number and per device                                                                                                                                                   | Phase 15                                                 |
| **Audit tampering**                      | Append-only by database rule; UPDATE and DELETE are silently discarded                                                                                                                                                  | migration 0006                                           |
| **Uncontrolled content change**          | No edge from draft to published; approvals checked on one transition; canary scoped to named kiosks; rollback restores its predecessor                                                                                  | Phase 14                                                 |

## What an attacker with the kiosk in their hands gets

Worth stating plainly, because it is the realistic scenario.

They get: a device code (a shared secret in configuration), whatever is on screen, and the
ability to start sessions. They do **not** get another patient's record — the kiosk has no
route to one — nor a token without a valid QR or a completed intake, nor the ability to read
a document (the kiosk never fetches one back), nor a usable session after the wipe.

The device code is the weak point, and it is unmitigated: `kiosk_device.cert_fingerprint`
exists and is unused. **mTLS is the intended control and is not built.**

## Open, in order of how much they would matter

1. **No staff SSO.** A sandbox provider only. Until a hospital IdP is wired in, clinician
   authentication is not real.
2. **No kiosk device certificates.** As above.
3. **Keys in environment variables.** Rotation is possible — every key carries an id and old
   ids stay readable — but the storage is not a key manager.
4. **No TLS configuration.** A deployment concern, and absent here.
5. **Break-glass is recorded, not reviewed.** It lands in a table and a log; nothing produces
   the periodic review that makes it a control rather than a record.
6. **Approvals are self-asserted.** The system does not check that the signed-in reviewer is
   the person named in the approval.
