# Phase 18 — Production deployment and release

The last phase, and the one where the honest answer to most of it is that a repository
cannot contain it. What can be built is the shape a hospital deploys into, the process a
change follows to get there, and — most usefully — an artifact that **refuses to declare the
system production-ready** and says exactly why.

## The readiness checklist evaluates itself

The specification's instruction is _"Do not claim production readiness until…"_, so the
useful artifact is not a document asserting readiness. It is one that will not.

`tools/src/production-readiness.ts` holds all sixteen criteria, each classified:

- **automated** — provable here, and proven by a check that runs. Ten of them.
- **deployment** — true of the code, but only real once a hospital has configured it. Three.
- **organisational** — nothing in a repository can satisfy it. Three.

`evaluateReadiness()` always returns `ready: false`, and deliberately is not a computation
that could one day return true. Whether a clinical system may see real patients is a
judgement a hospital makes with a practitioner and a lawyer in the room; a function that
announced it would be worth nothing and would be quoted by somebody in a hurry.

A test asserts every blocker carries more than a sentence of reasoning, and that the three
organisational criteria stay organisational — if one is ever reclassified as automated,
somebody has redefined the criterion rather than met it.

**The largest blocker is unchanged from Phase 17: no practitioner has authored or reviewed
any clinical content.** The consent notices and questionnaire ship marked
`0.1.0-placeholder`, and the six AYUSH modules contain zero questions.

## What the manifests deliberately leave out

`infra/deployment/docker-compose.prod.yml` runs two stateless API nodes behind a TLS proxy,
with read-only root filesystems, dropped capabilities, and every key required rather than
defaulted — a missing key stops the node instead of quietly generating an ephemeral one that
makes yesterday's documents unreadable.

It contains **no database and no object store**, on purpose. The specification asks for
PostgreSQL primary/standby or managed HA; a Postgres container with a local volume is
neither — it is a single point of failure wearing a production label. Same for MinIO. The
file says so in its own header rather than leaving somebody to discover it.

The segmented VLAN, the UPS and MDM enrolment are network and facilities work. The device
side is covered by `docs/runbooks/kiosk-device-setup.md`.

## Monitoring, finally wired

Phase 16 built the metrics and left "no dashboard, no delivery" as an open criterion.
`infra/monitoring/` now holds a Prometheus scrape config and alert rules that duplicate the
conditions `/v1/ops/alerts` evaluates — that endpoint answers "what is wrong now" when
somebody asks; these fire when nobody is asking. Both point at the same runbook, so a page
and a dashboard lead to the same instructions.

One rule is worth naming: `PatientsNotCompleting` watches the ratio of sessions reaching a
token. It is the only alert that measures whether the thing works for the people using it,
as opposed to whether the servers are up.

Delivery — Alertmanager to a hospital channel — is still not configured. It needs a
destination only the hospital has.

## Migrations are the rollback problem

`docs/runbooks/release-process.md` walks the nine steps. The part worth reading twice is
rollback: content rolls back through the console and restores its predecessor, code rolls
back by redeploying a pinned digest, and **a migration that dropped a column cannot be
undone by either**. Hence the guidance to prefer additive migrations across a release
boundary, and never to combine a destructive one with a feature release.

## Two security deliverables written

`docs/security/threat-model.md` works the specification's threat table against what is
actually built, and states plainly what an attacker holding a kiosk gets — which is little,
except that the device code is a shared secret and `cert_fingerprint` remains unused.

`docs/security/privacy-data-flow.md` traces what is collected, on what basis, who can see
it, and the two boundaries that surprise people: **the HIS sees no clinical content**, and
**the EMR sees only a record a clinician has signed**.

## The 23 deliverables

`docs/deliverables.md` maps every one to what exists, using the specification's own
vocabulary. Nineteen are production implementations. One is a placeholder (the AI worker).
Three are unwritten — the clinical governance guide, the accessibility and localisation
guide, and the pilot deployment guide — and all three are hospital-facing documents better
written _with_ a hospital than for one.

## Tests

| Suite                                    | Count |
| ---------------------------------------- | ----- |
| `tools/src/production-readiness.spec.ts` | 6     |

Full suites: **158 backend unit, 243 Flutter, 17 tools**, `verify` clean.

**The integration suite is green: 22 suites, 412 tests, ~43 seconds.**

It was not, when this phase was first written. Across three full runs one suite hung each
time — a different one each run — for around 600 seconds, always inside `truncateAll` in a
`beforeEach`, while every suite passed in isolation. That was recorded here as an open
defect rather than smoothed over, and it has since been root-caused.

The cause was in the product, not the harness. `KioskDeviceGuard` refreshed
`kiosk_device.last_seen_at` on every kiosk request and did not await it:

```ts
void this.db.updateTable('kiosk_device').set({ last_seen_at: sql`now()` })...
```

The response therefore returned while an uncommitted `UPDATE` still held a row lock on
`kiosk_device`. In the test suite the next thing to run is `TRUNCATE ... CASCADE`, which
needs `ACCESS EXCLUSIVE` on that same table; Postgres's `lock_timeout` defaults to `0`, so
it waited for the straggler indefinitely. Which suite lost the race depended on timing,
which is exactly why it moved around and why no suite reproduced it alone.

Two changes, one for the cause and one for the class of problem:

- The liveness write is now awaited, so it cannot outlive its request. It is also throttled
  to at most once per minute per device (`WHERE last_seen_at IS NULL OR last_seen_at <
now() - interval '60 seconds'`), so awaiting it costs nothing on the common path — past
  the first request in a minute the statement matches no rows and takes no row lock. The
  behaviour the operations dashboard depends on is unchanged: the offline threshold is
  measured in minutes, not seconds.
- `truncateAll` now runs under `SET LOCAL lock_timeout = '10s'` and, on timeout, reports
  the contents of `pg_stat_activity` in the failure message. A future regression of this
  shape fails in ten seconds naming the blocking session, instead of hanging for ten
  minutes naming nothing.

The general lesson is worth keeping: an unawaited write is not free just because nobody
reads the result. In a test run it corrupts the next test's setup; in an OPD it puts the
next patient's request behind a write no one is waiting for.

## Known limitations

- **Nothing is deployed.** The manifests have never been run; no staging environment exists.
- **No CD pipeline, no image signing, no SBOM.** CI runs the gates and stops there.
- **No load or soak testing.** A busy OPD morning remains the untested case.
- **No Grafana dashboards.** Prometheus rules exist; panels do not.
- **The compose file assumes two nodes on one host**, which survives a process crash but not
  the host. Real redundancy is two hosts, and that is an infrastructure decision.

## Exit criteria

The specification gives none for this phase beyond the readiness checklist, which is
answered above: **not ready, with six named blockers, three of which no repository can
close.**
