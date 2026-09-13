# Runbook — alerts

One section per alert, named to match the `runbook` field the alert carries. If you are
reading this because a page woke you, find your alert's heading and start there.

The rule this file exists to enforce: **no alert without instructions.** `runbook` is a
required field on every alert definition, so an alert cannot be added without a section
here. If nobody can write down what the recipient should do, the alert should not exist.

---

## KioskOffline

**Critical.** One or more enabled kiosks have not been seen for ten minutes.

A kiosk is "seen" whenever it makes any authenticated request — there is no separate
heartbeat, so silence means the device is off, crashed, or off the network.

1. **Is it in use?** An OPD kiosk goes quiet overnight and at weekends. Check the hour
   before escalating; this alert does not know the clinic's opening times.
2. **Look at it.** Somebody on the floor should physically check the machine. Powered off,
   unplugged network cable, and a frozen screen all look identical from here.
3. **Check for a crash burst.** `GET /v1/ops/device-events` — repeated `APP_CRASH` from that
   device points at the app rather than the hardware.
4. **If the device is compromised or cannot be reached**, disable it so it cannot start
   sessions: `UPDATE kiosk_device SET enabled = false WHERE code = '<code>';`

**Patient impact while it is down:** patients at that kiosk cannot check in. They can be
seen at the counter — that path never depends on this system.

---

## TokenReconciliationRequired

**Critical.** A token request has an outcome nobody knows.

See `docs/runbooks/qr-token-failures.md`, which covers this in full. In short: the hospital
may or may not have issued a token, MediKiosk will not guess, and the patient has been told
to see the counter. Resolve it by asking the HIS what it actually did — never by issuing
another token.

---

## ExportReconciliationRequired

**Critical.** A confirmed clinical record may or may not have reached the EMR.

1. **Do not re-export.** A duplicate clinical note is a second version of the truth that a
   clinician then has to reconcile by hand. The system already declined to guess; you should
   too.
2. **Ask the EMR.** Look for the record by the patient's UHID and the encounter date. The
   export's idempotency key is `export-<encounterId>` and a well-behaved EMR will have it.
3. **If the EMR has it**, mark the export acknowledged:
   ```sql
   UPDATE encounter_export SET state = 'ACKNOWLEDGED', his_record_ref = '<their ref>'
    WHERE encounter_id = '<encounter>';
   ```
4. **If it does not**, re-run the export through the API. It is idempotent, so this is safe
   once you have established the EMR does not hold it.

**Clinical impact:** the record exists and is confirmed in MediKiosk either way. What is at
risk is the treating clinician not finding it in the EMR at the next visit.

---

## SessionEndedWithoutWipe

**Critical.** A kiosk session ended without the device confirming it cleared itself.

This is a **privacy** alert, not a performance one: a patient's answers, photographs of
their documents, or camera buffers may still be on a device standing in a public corridor.

Sessions closed by the server-side sweep carry no attestation by design — the sweep exists
for kiosks that crashed or lost power, which are exactly the ones that never wiped. So this
alert firing means: _a device may be holding patient data and nobody has confirmed
otherwise._

1. **Identify the device**, then physically secure it. Do not leave it in front of patients.
2. **Restart the app.** A clean start clears in-memory state and runs the wipe.
3. **If the device crashed**, check `device_event` for `APP_CRASH` around that time and
   attach the correlation id to the incident.
4. **If more than a couple of devices are affected at once**, treat it as an incident and
   follow `docs/runbooks/breach-response.md` — a fleet-wide failure to wipe is a data
   exposure, not a bug report.

---

## RepeatedMalwareUploads

**Warning.** Three or more uploads refused by the malware scanner within an hour.

A patient photographing a prescription does not trip this. A cluster at one kiosk is
somebody probing the uploader.

1. **Which kiosk?** Check `document` rows with `state = 'REJECTED_MALWARE'` and their
   `pre_checkin_id`, then the kiosk that opened those visits.
2. **Nothing was stored.** A refused upload writes a row and no bytes — there is no infected
   file on disk to clean up. That is worth knowing before anyone panics.
3. **If it is one kiosk repeatedly**, disable it and inspect it physically. A device with a
   USB port somebody has found is the usual explanation.
4. **If it is spread across kiosks**, it is more likely a genuine content problem — a
   hospital PDF template with embedded JavaScript will trip the heuristic scanner. Check the
   `rejection_reason` before assuming an attack.

---

## RepeatedQrFailures

**Warning.** Ten or more QR check-ins refused in fifteen minutes.

Every individual refusal is correct and deliberately silent — the kiosk tells the patient
nothing about _why_ a code failed, so it cannot be used as an oracle. That is precisely why
the pattern has to be surfaced here instead.

1. **Look at the reasons**, which are in the audit trail and not on any screen:
   `SELECT detail FROM audit_event WHERE action = 'ARRIVAL_QR_REFUSED' ORDER BY occurred_at DESC LIMIT 50;`
2. **All expired?** Likely a real operational problem: patients arriving long after their
   pre-check-in window. Talk to the department about appointment timing rather than treating
   it as an attack.
3. **All wrong-facility?** Patients at the wrong site, or a QR issued against another branch.
4. **Mixed, from one kiosk, in quick succession?** That is someone trying codes. Disable the
   device and preserve the audit rows.

---

## UnusualAccessPattern

**Warning.** Five or more break-glass accesses in twenty-four hours.

Break-glass is legitimate — a doctor covering another department's clinic needs it, and
refusing them would be worse than the risk. It is meant to be _rare_, and a burst is the
signal.

1. **Read the reasons.** `SELECT * FROM break_glass_access ORDER BY accessed_at DESC;` Each
   one has a typed justification from the person who used it.
2. **One clinician covering a clinic** is the benign explanation and will read that way.
3. **One clinician across many patients with thin reasons** is not. Escalate to the
   hospital's information-governance lead — this is their decision, not IT's.
4. **Do not disable the account on suspicion alone** unless a governance lead agrees. A
   doctor locked out mid-clinic is a patient-safety problem.

---

## DeviceHardwareFault

**Warning.** A printer or scanner fault reported in the last hour.

1. **Printer out of paper** is the common case and is a floor task, not an IT one.
2. **A patient's token is never lost to a printer fault.** The token is displayed on screen
   and remains valid; the kiosk says so explicitly. Nobody needs to re-issue anything.
3. **A scanner fault** means documents cannot be added at that kiosk. The kiosk degrades
   correctly — it stops offering the option rather than failing when pressed — and patients
   can show papers to the doctor.

---

## RepeatedAppCrashes

**Critical.** Three or more kiosk app crashes in an hour.

1. **Check whether it is one device or several.** One device points at hardware or a corrupt
   install; several point at a release.
2. **Check what changed.** A governance release can reach kiosks without an app update — see
   whether content was published or a canary started shortly before the crashes:
   `SELECT content_key, semver, state, published_at FROM governance_version ORDER BY published_at DESC LIMIT 10;`
3. **If a canary is implicated, roll it back.** That is what canaries are for, and rollback
   restores the previous version so no kiosk is left with nothing.
4. **Crashes leave sessions unwiped.** Expect `SessionEndedWithoutWipe` alongside this, and
   handle that one too — it is the part with patient data in it.
