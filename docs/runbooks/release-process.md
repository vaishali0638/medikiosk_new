# Runbook — release process

From a developer's branch to a hospital's kiosks. Nine steps, and the two that matter most
are the ones a software team cannot perform alone.

```
branch → pull request → automated tests → security scan → staging
       → clinical/content review → hospital UAT → canary → monitored rollout
       → rollback if required
```

## 1. Branch and pull request

Never commit to the default branch. A clinical system's history has to be reviewable after
an incident, and "who approved this" is part of that.

## 2. Automated tests

`npm run verify` is the gate and it runs in CI: format, lint, typecheck, the
forbidden-option scan, and every unit test. Integration tests need PostgreSQL and run as a
separate job; `flutter analyze` and `flutter test` cover the kiosk.

A release does not proceed on a red build. There is no override, because an override is
always used at the worst moment.

## 3. Security scan

Dependency audit plus the adversarial suite (`security.int-spec.ts`). A new critical
advisory in a transitive dependency stops a release exactly as a failing test does.

## 4. Staging

Deploy to an environment configured exactly as production — same adapters, same secret
manager, different data. The most common deployment failure is a configuration difference
nobody knew existed, and staging only catches it if staging is not special.

Run the restore drill here, not in production: `docs/runbooks/backup-and-restore.md`.

## 5. Clinical and content review

**This step is not the software team's.** Any change to a questionnaire, a consent notice,
an AYUSH module, a red-flag rule or a summary template goes through the governance console:
authored, reviewed by the named roles that content kind requires, approved by at least two
distinct people, published.

Content and code release independently, deliberately. A questionnaire correction should not
wait for an app release, and an app release should not silently change what a patient is
asked.

## 6. Hospital user-acceptance testing

Hospital staff, on staging, running the workflows they actually run. Not a demonstration —
a demonstration goes forwards, and the failures worth finding are sideways.

## 7. Canary

**Content**: the governance console releases to named kiosks. Both versions run at once;
that is the point of a canary.

**Code**: deploy to one node, or one branch's kiosks, and watch. What to watch is in
`infra/monitoring/alert-rules.yml` — the completion rate first, because a release that
breaks the journey shows there long before it shows in an error count.

## 8. Monitored rollout

Widen only after a full clinic session on the canary. A morning OPD is the load test; a
quiet afternoon proves nothing.

## 9. Rollback

**Content**: through the console, with a reason. Rolling back restores the version it
superseded, so no kiosk is left with nothing — that would be an outage, not a rollback.

**Code**: redeploy the previous pinned digest. **Migrations are the exception**, and the
thing to plan for:

- Every migration here has a Down section, exercised up/down/up before it lands.
- Prefer additive migrations across a release boundary — add the column, deploy code that
  writes both, drop the old one a release later. A rollback then needs no database change.
- Never combine a destructive migration with a feature release, or a rollback of one
  becomes a rollback of the other.

## What this repository does not provide

- **A CD pipeline.** CI runs the gates; nothing deploys. The hospital's tooling does.
- **A staging environment.** The manifests describe one; nobody has stood it up.
- **Image signing or an SBOM.** Both belong here; neither is configured.
