# Phase 16 — Observability and operations

The objective is "make the system supportable in real hospital operations", which in
practice means: when something is wrong at 2am, can the person who gets paged find out what,
and does anything tell them what to do about it.

## Metrics

`GET /v1/metrics`, Prometheus text format, behind the operations credential.

Everything is a **count or a rate**. Nothing carries a patient id, a mobile number, a
document or any clinical text — a metrics endpoint is scraped every fifteen seconds into a
time-series database that is not covered by the consent a patient gave, so the rule is that
it may say _how many_ and never _who_. A test asserts the output contains no UUID-shaped
string and that every line is either a comment or a name and a number.

Computed on demand rather than kept as in-process counters. Counters in memory are lost on
restart and are wrong the moment there are two instances; the database already knows the
answers and is the only place both instances agree.

The series cover the specification's monitor list where it is derivable: kiosk online/
offline, OCR queue depth and failures, outbox depth, HIS token outcomes, EMR export
outcomes, and session completion, exit, timeout and error counts. Patient-facing outcome
rates are there deliberately — a rising exit rate is a usability failure long before it is
an outage, and nothing else in the system would show it.

## Device events

The rest of the monitor list is things **only the device knows**: it crashed, the network
went away mid-upload, the printer is out of paper. `POST /v1/kiosk/events` takes them.

The `kind` is a closed set, not free text. A free-text kind becomes a dozen spellings of one
fault and an alert rule that matches none of them.

The detail is **redacted before storage** with the same function the audit trail uses. A
crash report is exactly the payload that arrives carrying a patient's details in a local
variable, and a kiosk sending its own telemetry is not a reason to relax the rule that
operational data holds no clinical content. In the walkthrough, `{exception: 'StateError',
mobile: '9876500099', code: '482913'}` was stored as `{exception: 'StateError', mobile:
'******0099', code: '[REDACTED]'}`.

Device clock and server clock are kept apart. A kiosk that was offline reports late, and the
gap between `occurred_at` and `reported_at` is itself information about the outage.

## Alerts, and the rule about runbooks

`GET /v1/ops/alerts` evaluates nine conditions. Every alert carries a `runbook` field, and it
is **required by the type** — an alert cannot be defined without naming a document.

That was not enough on its own, so a unit test now checks that:

- every alert has a section in `docs/runbooks/alerts.md`, or delegates to a runbook file
  that **exists**;
- every section corresponds to an alert that still exists, because a section for a deleted
  alert tells whoever is on call that a condition is handled when nothing raises it;
- every section contains numbered steps rather than prose, because a description of the
  problem is what the recipient already has.

**That test immediately found a dead end.** `TokenReconciliationRequired` pointed at
`docs/runbooks/qr-token-failures.md`, which Phase 7's plan promised and nobody ever wrote.
It is written now.

Thresholds are conservative on purpose. An alerting system people learn to ignore is worse
than none, because it also hides the real one.

## The finding: a falsified wipe attestation

The metric `medikiosk_sessions_ended_without_wipe` could never fire, and working out why
exposed a real defect.

`kiosk_session_ended_is_wiped` (migration 0004) required `wiped_at` on every `EXITED` **or
`EXPIRED`** session. That is correct for `EXITED`: the client ends the session and attests,
in the same statement, that it cleared its own buffers, and a client that does not attest
fails loudly.

It is wrong for `EXPIRED`. The server-side sweep exists precisely for sessions whose device
never got to run its own timer — it crashed, or lost power. The constraint left that sweep
no choice but to write `wiped_at = now()`, so **the field recorded a wipe attestation for
exactly the sessions least likely to have been wiped.**

Migration `0023` splits them: a client-ended session must still attest, and a server-expired
one records what is true — nothing confirmed the wipe. The sweep no longer writes the field,
the metric counts those sessions, and `SessionEndedWithoutWipe` is a CRITICAL alert with a
runbook that treats it as a privacy incident rather than a performance one, because a device
may still be holding a patient's answers and photographs of their documents.

This is the second time a monitor has been more informative than the thing it monitors: the
value of building the alert was not the alert, it was discovering that the state it watches
for was being papered over.

## Tests

| Suite                              | Count |
| ---------------------------------- | ----- |
| `test/observability.int-spec.ts`   | 17    |
| `src/observability/alerts.spec.ts` | 4     |

Full suites: **158 backend unit, 399 backend integration, 240 Flutter**. `verify` clean.

Walked end to end against `dist/main.js`: metrics refused without a credential; a quiet
system firing one alert (two seeded kiosks that have never connected — correct); a kiosk
checking in and being counted online; a crash report redacted on the way in; and three
crashes plus a printer fault producing three alerts, each naming its runbook.

## Known limitations

- **No dashboard.** The exit criterion says "dashboard exists". `/v1/metrics` is a
  Prometheus endpoint and `/v1/ops/alerts` is JSON; a Grafana instance and its panels are
  deployment work, and there is no `infra/monitoring` content to point at.
- **Alerts are evaluated on request, not pushed.** Nothing delivers them to a hospital
  channel — no Alertmanager route, no email, no pager. The exit criterion "alerts reach the
  responsible hospital/IT channel" is **not met**, and a hospital would need to poll the
  endpoint or wire Prometheus rules against the metrics.
- **No ASR or summary latency**, because there is no ASR and no model. Same for OCR
  correction rate and doctor edit rate: both need a clinician surface that does not exist.
- **No storage-capacity metric.** The local object store has no quota to report against, and
  the real deployment target is MinIO or S3, which report their own.
- **No backup-failure alert**, because there is no backup job in this repository to fail.
- **Log hygiene is asserted for metrics and device events**, not for the application log as
  a whole. The redaction function is applied at the audit and telemetry boundaries; a
  developer adding a `logger.log(patient)` elsewhere is not caught by anything.

## Exit criteria

| Criterion                               | Status                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| Dashboard exists                        | **Partly** — a metrics endpoint and an alerts endpoint; no Grafana instance or panels |
| Alerts reach the responsible channel    | **Not met** — evaluated on request; no delivery is wired                              |
| Runbooks exist for every critical alert | Verified — enforced by a test, which found and closed a missing one                   |
| Logs avoid sensitive clinical content   | Verified for metrics and device telemetry; the wider application log is by convention |
