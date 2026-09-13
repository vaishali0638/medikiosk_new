# Access matrix

Who may do what, and where each rule is enforced. A matrix that only exists in a document
is a description; every row here names the code or constraint that makes it true, so it can
be checked rather than believed.

## Actors

| Actor                  | Authenticated by               | Scope                           |
| ---------------------- | ------------------------------ | ------------------------------- |
| Patient (mobile PWA)   | OTP to their own number        | Their own pre-check-in          |
| Kiosk device           | Provisioned device code        | Its own branch                  |
| Clinician              | Hospital SSO → staff session   | Their department                |
| Governance reviewer    | Hospital SSO → staff session   | Their hospital's content        |
| Operations             | Hospital SSO → staff session   | Queue plumbing, no patient data |
| System (retention job) | No credential; runs in-process | Deletion only, never reads out  |

## Matrix

| Action                           | Patient | Kiosk | Clinician         | Governance | Operations |
| -------------------------------- | ------- | ----- | ----------------- | ---------- | ---------- |
| Create pre-check-in              | ✅ own  | ✅    | ❌                | ❌         | ❌         |
| Grant consent                    | ✅ own  | ✅    | ❌                | ❌         | ❌         |
| Answer intake questions          | ✅ own  | ✅    | ❌                | ❌         | ❌         |
| Upload a document                | ✅ own  | ✅    | ❌                | ❌         | ❌         |
| Read a clinical record           | ❌      | ❌    | ✅ own dept       | ❌         | ❌         |
| Read another department's record | ❌      | ❌    | ⚠️ break-glass    | ❌         | ❌         |
| Confirm a record                 | ❌      | ❌    | ✅                | ❌         | ❌         |
| Export to the EMR                | ❌      | ❌    | ✅ confirmed only | ❌         | ❌         |
| Publish clinical content         | ❌      | ❌    | ❌                | ✅         | ❌         |
| View reconciliation queue        | ❌      | ❌    | ❌                | ❌         | ✅         |

A kiosk **writes** clinical data on a patient's behalf and can **read back only the visit in
front of it**. It never reads a clinical record: `document.state`, extraction confidence and
rejection reasons are withheld from it (Phase 10), and it has no route to another patient's
history at all.

## Where each rule lives

| Rule                                              | Enforced by                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| A kiosk must be provisioned and enabled           | `KioskDeviceGuard`                                                  |
| A clinician must hold a live session              | `StaffAuthGuard`                                                    |
| Only a CLINICIAN reads clinical records           | `EncounterAccessService.require`                                    |
| A record must be in the caller's hospital         | `EncounterAccessService.require`, joined in the query               |
| A record outside the department needs break-glass | `EncounterAccessService.require` + `break_glass_access` table       |
| Only a GOVERNANCE_REVIEWER releases content       | `GovernanceController.requireReviewer`, `ReleaseService.transition` |
| Only a confirmed record exports                   | `ExportService.loadVerified`                                        |
| A draft cannot be labelled clinician-verified     | `clinical_summary_verified_label` (DB)                              |
| Live content must name a publisher                | `governance_version_live_is_published` (DB)                         |
| A submission requires a confirmed review          | `review_confirmed` CHECK (DB)                                       |
| Consent must be live for every clinical write     | `ConsentService.requireActiveConsent`, re-checked per call          |

The last four are **database constraints**, not application checks. They survive a refactor
that deletes the code above them.

## Refusals are uniform

Every refusal that could be used to probe returns the same code, status and body regardless
of cause:

- **Identity**: expired, wrong, and locked-out OTP codes are one message. A wrong UHID and
  an unknown one are one message.
- **QR**: expired, replayed, wrong-hospital and forged codes are all `422`, one body.
- **Records**: absent, other-hospital and other-department are all `403`, one body.
- **Ids**: a malformed id and a well-formed unknown one are both `400`, one body.

This is asserted by tests in `test/security.int-spec.ts`, comparing response bodies field by
field rather than trusting that the code paths look similar.

## Known gaps

- **Staff SSO is a sandbox provider.** OIDC against a hospital IdP is unbuilt (Phase 13).
- **Kiosk device certificates are not verified.** `kiosk_device.cert_fingerprint` exists and
  is unused; today a device is identified by a code in a header, which is a shared secret
  visible to anyone who can read the device's configuration. mTLS is the intended control.
- **Approvals are self-asserted.** A governance reviewer records "approved by Dr Sharma";
  the system does not check that the signed-in user is Dr Sharma.
