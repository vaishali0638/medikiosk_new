# Privacy and data flow

Where a patient's information goes, why it is there, and when it leaves. Written for a
hospital's data-protection officer as much as for an engineer.

## What is collected, and on what basis

Nothing is collected before consent. The consent notice is a standalone, versioned,
governed document; the patient reads or hears it, agrees or declines, and a declining
patient is told plainly that they can still be seen at the counter. The version they were
shown is recorded on the consent, so a record can be traced to the exact wording.

| Category         | Examples                                      | Why                               |
| ---------------- | --------------------------------------------- | --------------------------------- |
| Demographics     | Name, age, sex, mobile                        | Identifying the right patient     |
| Identifiers      | UHID, ABHA (optional, off)                    | The hospital's own key            |
| Clinical answers | Questionnaire responses, AYUSH module answers | The consultation                  |
| Documents        | Photographs of prescriptions and reports      | The clinician reads the originals |
| Derived          | OCR extractions, generated drafts             | Preparation, never a record       |
| Operational      | Sessions, audit events, device telemetry      | Safety, security, support         |

**Aadhaar is never collected. A smartphone is never required. Location is never collected.**

## The flow

```
patient at kiosk ──consent──▶ core_api ──▶ PostgreSQL (encrypted at rest by the platform)
       │                          │
       │ documents                ├──▶ object store  (AES-256-GCM, encrypted BY the app,
       │                          │                   so the operator holds ciphertext)
       │                          ├──▶ HIS           (token request: identifiers only,
       │                          │                   never clinical content)
       │                          └──▶ EMR           (the confirmed record, after a
       │                                              clinician signs it)
       └── wiped on exit, timeout, completion or error
```

Two boundaries are worth naming because they are the ones that surprise people.

**The HIS sees no clinical content.** A token request carries a UHID, a department and a
visit type. What the patient said is not part of asking for a queue position.

**The EMR sees only a confirmed record.** Never a draft. The export reads
`encounter.verified_at`, which cannot be set without a named clinician.

## What each party can see

| Party               | Sees                                      | Does not see                                                                             |
| ------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| The kiosk           | The visit in front of it, masked identity | Any other patient; any clinical record; why a document was refused; any confidence score |
| The patient's phone | Their own pre-check-in and QR             | Anything about anyone else                                                               |
| A clinician         | Their department's records, in full       | Other departments without break-glass; other hospitals at all                            |
| Governance          | Content and its approvals                 | No patient data whatsoever                                                               |
| Operations          | Queue depths, stuck items, device faults  | No patient data                                                                          |
| Metrics             | Counts and rates                          | No identifier — asserted by test                                                         |

## What is deliberately never stored or logged

- **OTP codes** — HMAC'd, never in plaintext, never in the audit trail.
- **Full mobile numbers in logs** — masked by `redact()` at the audit and telemetry
  boundaries.
- **Clinical text in audit details** — the audit records that a thing happened and to which
  entity; the content is in the row.
- **Document bytes in PostgreSQL** — object key, hash and metadata only.
- **Patient identifiers in metrics** — a scrape endpoint feeds a time-series database not
  covered by the consent the patient gave.
- **Filenames as trusted input** — a patient-supplied filename is stored for the clinician's
  benefit and never used to build a path or enter a draft.

## QR codes carry no medical data

A signed reference only: pre-check-in id, facility, visit window, expiry, nonce. The code is
displayed on a phone screen in a public waiting area and may be photographed by anyone
standing nearby, so it is designed to be worthless to them.

## Retention

Deletion happens only under a policy the hospital has approved and recorded, naming who
approved it and when. **No policy means nothing is deleted** — an absent policy is an
unanswered question, not permission.

A live legal hold stops deletion outright and always beats the policy: keeping data slightly
too long is a privacy fault, destroying it under a hold is spoliation, and the two are not
comparable.

The audit trail is never deleted. A deletion nobody can prove happened is not a deletion
anybody can defend.

## Patient rights

| Right               | Position                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| Withdraw consent    | Built. Withdrawal is immediate and re-checked on every clinical call, so an intake stops mid-way                |
| Access their record | **Not built.** No patient-facing export exists; the hospital serves such a request from its own systems         |
| Correction          | Partial. A patient corrects answers on the review screen before submitting; afterwards it is a clinician's edit |
| Erasure             | Via the hospital's retention policy and legal hold, not a self-service action                                   |

## Open

- **No data-protection impact assessment.** An organisational deliverable; not done.
- **No processor agreement.** Same.
- **Cross-border**: nothing here pins storage to an India region. That is a deployment
  choice the manifests describe but do not enforce.
- **No patient-facing access or export**, as above.
