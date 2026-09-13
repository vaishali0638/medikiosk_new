# Runbook — suspected data breach

For the person on call. Assume you are reading this at 2am and have not read it before.

**The first hour is about stopping the bleeding and preserving evidence. It is not about
finding out who is to blame, and it is not about deciding whether it is really a breach.**

## 0. Before you touch anything

Do **not** delete anything. Do not "clean up" a compromised account, drop a table, or clear
a log. `audit_event` is append-only by database rule and cannot be rewritten — that is
deliberate, and the same discipline applies to everything else. If deletion later turns out
to have destroyed the only evidence of what happened, the incident becomes much worse.

Place a legal hold immediately if any patient is identifiable:

```sql
INSERT INTO legal_hold (hospital_id, patient_id, reason, placed_by)
VALUES ('<hospital>', '<patient>', 'suspected data breach <date>, under investigation', '<your name>');
```

A hold beats the retention policy, so the nightly purge will not remove the records while
you investigate.

## 1. Contain (minutes)

**A compromised staff account** — revoke every session, then disable the account:

```sql
UPDATE staff_session SET revoked_at = now()
 WHERE staff_user_id = '<user>' AND revoked_at IS NULL;
UPDATE staff_user SET enabled = false WHERE id = '<user>';
```

Both matter: disabling alone leaves live sessions working until they expire — except that
`StaffAuthService.resolve` also checks `staff_user.enabled`, so in this system disabling
does end access immediately. Revoke anyway; do not rely on one control under pressure.

**A compromised kiosk** — disable the device. It stops being able to start sessions or read
config:

```sql
UPDATE kiosk_device SET enabled = false WHERE code = 'MK-OPD-0X';
```

Then physically remove it from the floor. A kiosk in a public corridor that you believe is
compromised should not stay in front of patients while you think about it.

**A leaked document link** — links expire in two minutes and are bound to one staff user, so
a leaked one is almost certainly already dead. Rotate `DOCUMENT_LINK_KEY` if you want
certainty; every outstanding link stops working.

**A leaked signing key** (`QR_SIGNING_KEY`) — rotate it. Outstanding QR codes stop
verifying, and patients holding one must check in at the counter. That is disruptive and
correct: a leaked signing key means anyone can mint a valid arrival.

## 2. Scope (first hour)

Everything a staff member did is in the audit trail:

```sql
SELECT occurred_at, action, entity_type, entity_id, correlation_id
  FROM audit_event WHERE actor_id = '<user>' ORDER BY occurred_at DESC;
```

Break-glass access is in its own table precisely so it can be listed without filtering
millions of ordinary events:

```sql
SELECT * FROM break_glass_access ORDER BY accessed_at DESC LIMIT 200;
```

Records read, confirmed or exported:

```sql
SELECT * FROM audit_event
 WHERE action IN ('CLINICAL_RECORD_VIEWED','CLINICAL_RECORD_CONFIRMED','CLINICAL_RECORD_EXPORTED')
   AND occurred_at > now() - interval '30 days';
```

Write down the **count of distinct patients** involved. That number, not the number of
events, is what determines the notification obligation.

## 3. Notify

Notification duties are set by the hospital and by Indian data-protection law, not by this
document, and they run on a clock that starts when the hospital becomes aware — which is
now, not when the investigation finishes. Contact, in this order:

1. The hospital's data-protection officer or information-governance lead.
2. The hospital's medical superintendent, if any patient's clinical record was exposed.
3. The MediKiosk operator, with the correlation ids you collected above.

Do not notify patients directly on your own initiative. That is the hospital's decision and
its wording.

## 4. What this system makes easy to answer

- **What did they see?** Every read of a clinical record is audited with the actor and
  correlation id.
- **Did they change anything?** Confirmations write a new summary and never overwrite the
  draft, so the before and after both exist.
- **Did it leave the building?** `encounter_export` records every EMR export with its state.
- **Was the patient's own data at risk on the device?** `kiosk_session.wiped_at` records
  whether the device confirmed a wipe.

## 5. What it cannot answer

- **Reads at the database level.** Someone with direct SQL access reads without an audit
  event. Database access logging is the hospital's infrastructure responsibility.
- **What was on screen.** The audit trail records that a record was opened, not what the
  clinician looked at within it.
- **Anything before Phase 13.** Staff identity and clinical-record auditing arrived then.

## After

Write the incident up while it is fresh, including what this runbook did not cover. Add it.
