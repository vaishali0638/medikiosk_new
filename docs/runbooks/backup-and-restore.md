# Runbook — backup and restore

A backup nobody has restored is a hypothesis. This describes the drill, and the parts of
this system that make a restore more complicated than `pg_restore`.

## What has to be backed up

| What                    | Where                    | Without it                                       |
| ----------------------- | ------------------------ | ------------------------------------------------ |
| PostgreSQL              | the whole database       | Everything. Consent, records, audit, governance. |
| Object store            | encrypted document blobs | Every original document a patient handed over.   |
| `OBJECT_ENCRYPTION_KEY` | secret manager           | The document backups are unreadable ciphertext.  |
| `OTP_HMAC_SECRET`       | secret manager           | In-flight OTPs stop verifying. Low impact.       |
| `QR_SIGNING_KEY`        | secret manager           | Outstanding QR codes stop verifying.             |

**The keys are the part people forget.** Documents are encrypted with AES-256-GCM before
they reach the object store, so a database and object-store backup restored without
`OBJECT_ENCRYPTION_KEY` gives you a complete-looking system in which no document can be
opened. Back the keys up separately, and to somewhere that is not the same blast radius.

## Restore drill

Run it on a scratch environment, not production. Quarterly, and after any schema change
that adds a table with a constraint.

**1. Restore the database.**

```bash
createdb medikiosk_restore
pg_restore -d medikiosk_restore --no-owner /backups/medikiosk-<date>.dump
```

**2. Check the migration state matches the code you are about to run.**

```bash
psql -d medikiosk_restore -tAc "SELECT name FROM schema_migrations ORDER BY id DESC LIMIT 1;"
```

A backup taken before a migration will fail to boot against newer code. Restore, then
migrate — never the other way round.

**3. Restore the object store**, and set `OBJECT_ENCRYPTION_KEY` to the key that was current
when those documents were written. If keys have been rotated, every key id in
`document.encryption_key_id` must be available; the column exists precisely so a rotation
does not orphan older documents.

**4. Boot and verify.**

```bash
DATABASE_URL=postgres://localhost:5432/medikiosk_restore npm run smoke -w @medikiosk/core-api
```

**5. Verify the things a `pg_restore` success message does not.**

```sql
-- Nothing live without a publisher, and nothing published twice.
SELECT content_key, count(*) FROM governance_version
 WHERE state = 'PUBLISHED' GROUP BY content_key HAVING count(*) > 1;

-- Every verified encounter still points at a summary that exists.
SELECT count(*) FROM encounter e
  LEFT JOIN clinical_summary s ON s.id = e.verified_summary_id
 WHERE e.verified_at IS NOT NULL AND s.id IS NULL;

-- The audit trail is append-only. This must report two rules.
SELECT rulename FROM pg_rules WHERE tablename = 'audit_event';
```

All three must come back empty, empty, and two rules.

**6. Open a document.** Pick any row with `state = 'STORED'` and fetch it through the API.
This is the only step that proves the encryption key survived the backup, and it is the
step most likely to fail.

**7. Record the result.** Date, backup used, time to restore, and what broke. A drill with
no written outcome is a drill nobody can point to during an audit.

## Restoring into production after a real loss

Additionally:

- **Put a legal hold on affected patients first** if the loss is under investigation, so the
  retention purge does not delete evidence while you work.
- **Expect in-flight state to be lost.** QR nonces, arrival handles and staff sessions are
  short-lived by design; patients mid-journey will need to start again, and that is the
  correct outcome rather than something to engineer around.
- **Check `integration_outbox` and `encounter_export`** for work that was in flight. An
  export in `SENT` may or may not have reached the EMR — ask the EMR before resending, the
  same rule the code follows.

## What is not automated

Backup scheduling, retention of the backups themselves, off-site copies and encryption of
the backup medium are all deployment concerns and are not configured in this repository.
There is no backup job here to point at.
