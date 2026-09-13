# governance_web

Clinical governance console: authoring, approval, canary release, publication and rollback.
Renders the endpoints built in Phase 14.

```bash
npm run dev -w @medikiosk/governance-web    # http://localhost:3003
```

Needs `core_api` running with `STAFF_IDP=sandbox`, and a `staff_user` row with role
`GOVERNANCE_REVIEWER`.

## What this surface is careful about

**It only offers moves the state machine permits.** There is no button from a draft to
published, because there is no such edge — the approval gate sits on `IN_REVIEW → APPROVED`
and everything downstream is unreachable without it.

**Refusals are shown verbatim.** The server lists everything wrong with a release at once —
missing roles, no distinct second approver, no stated qualification, a pre-release version.
An author fixing one thing per review cycle abandons the process, so the console does not
summarise the refusal into "invalid".

**The distinct-approver count is on screen.** One person holding four roles is not four
checks, and seeing the number is how a reviewer notices before the server refuses.

**What the hospital cannot yet run is listed first.** A kiosk with no published consent
notice in a language it offers stops dead for every speaker of it, so the gaps are reported
per language rather than per content kind.
