# Runbook — QR and token failures

Promised by Phase 7 and written in Phase 16, when an automated check found the alert
pointing at a file that did not exist.

Two related situations: a patient's QR code will not work, and a patient's token has an
outcome nobody knows. The second is the serious one.

---

## The rule that governs all of this

**MediKiosk never invents a token, and never issues a second one for a visit.**

A token is the hospital's, not ours. If the HIS may already have issued one, the answer is
to ask the HIS — never to try again and hope. A patient with two tokens is a patient the
queue counts twice, seen twice or not at all, and the confusion lands on the clinician.

Four things enforce this and none of them should be worked around by hand:

1. The idempotency key is derived (`<kioskCode>-<preCheckinId>`), never client-supplied.
2. That column is UNIQUE, so concurrent requests collapse.
3. An already-ISSUED request short-circuits before the HIS is contacted.
4. A partial unique index refuses a second ISSUED row for the visit.

---

## A patient says their QR will not work

The kiosk deliberately tells them nothing about why — expired, replayed, wrong hospital and
forged all produce one identical screen, because a kiosk that distinguished them would be an
oracle for testing stolen codes. The reason is in the audit trail.

```sql
SELECT occurred_at, detail
  FROM audit_event
 WHERE action = 'ARRIVAL_QR_REFUSED'
 ORDER BY occurred_at DESC LIMIT 20;
```

| What you find     | What it means                           | What to do                                     |
| ----------------- | --------------------------------------- | ---------------------------------------------- |
| `EXPIRED`         | They arrived outside their visit window | Check in at the counter. Do not extend the QR. |
| `NONCE_CONSUMED`  | The code was already scanned            | They may already have a token — check below.   |
| `WRONG_FACILITY`  | Issued for another hospital or branch   | Counter. They may be at the wrong site.        |
| `BAD_SIGNATURE`   | Not a code this system issued           | Counter, and note it — see below.              |
| `NONCE_NOT_FOUND` | A spliced or fabricated code            | Counter, and note it.                          |

**A cluster of `BAD_SIGNATURE` or `NONCE_NOT_FOUND` is not a patient problem.** Somebody is
trying forged codes. That fires `RepeatedQrFailures` — see `alerts.md`.

**Never re-issue a QR to get someone past a refusal.** If they should be seen, the counter
route always works and does not depend on this system.

---

## A token request has an unknown outcome

`TokenReconciliationRequired`. The HIS did not answer, or answered in a way that did not say
whether it acted. The patient has been shown "please speak to the counter" — which is
correct and is not a fault you need to undo.

### 1. Find them

```sql
SELECT tr.id, tr.pre_checkin_id, tr.idempotency_key, tr.state,
       tr.attempt_count, tr.last_error_code, tr.updated_at
  FROM token_request tr
 WHERE tr.state = 'UNKNOWN_RECONCILIATION_REQUIRED'
 ORDER BY tr.updated_at DESC;
```

### 2. Try the automatic sweep first

It asks the HIS about each stuck request and resolves the ones the HIS can answer.

```bash
curl -X POST -H "Authorization: Bearer $OPS_API_KEY" \
     -H "x-correlation-id: $(uuidgen)" \
     https://<host>/v1/ops/reconciliation/sweep
```

Most items clear here. The sweep only ever _reads_ from the HIS and then records what it
found; it never issues anything.

### 3. What the sweep cannot resolve

If the HIS still cannot say, a person has to look — in the HIS itself, by UHID and date.

- **The HIS has a token for this visit.** Record it and stop. The patient already has a
  queue position; give them the number.
  ```sql
  UPDATE token_request
     SET state = 'ISSUED', his_token = '<their token>', issued_at = now()
   WHERE idempotency_key = '<key>';
  ```
- **The HIS has nothing.** It is safe to request again through the API. The idempotency key
  is unchanged, so if the HIS did quietly hold one, it returns the same token rather than
  making a second.
- **You cannot tell.** Leave it. Send the patient through the counter and let the department
  resolve it with the HIS team. An unresolved row costs nothing; a duplicate token costs a
  clinician their afternoon.

### 4. Afterwards

Note the `last_error_code` and how long the HIS took. A pattern of timeouts at a particular
hour is usually the HIS being busy, and the department should know rather than each stuck
patient being handled as a one-off.

---

## The printer failed after a token was issued

Not an incident. The token is on screen and valid; the kiosk says so explicitly and tells
the patient to note it down or photograph it. Printing never changes token state, and there
is nothing to re-issue. Refill the paper — that is a floor task.

---

## What not to do

- **Do not issue a token by hand in the HIS** while a MediKiosk request is outstanding
  without recording it here. The next sweep will find the HIS holds one and reconcile
  correctly, but only if nobody has meanwhile forced a second request.
- **Do not clear `token_request` rows** to "reset" a patient. The row is the record of what
  was asked and answered; deleting it removes the only evidence of a duplicate if one exists.
- **Do not extend a QR's expiry.** Short expiry is what makes a photographed code useless.
