# Phase 7 — HIS/queue token adapter

## Objective

Connect arrival confirmation to the official hospital queue, safely.

## The rule everything here serves

> A patient gets at most one token for a visit, ever.

A patient holding two tokens is queued twice, seen twice, or turned away — and the
hospital cannot tell which is real. Four independent mechanisms enforce it, at four
layers, because any single one can be defeated by a bug:

1. The idempotency key is **derived** (`<kioskCode>-<preCheckinId>`), never client-supplied,
   so every retry path converges on the same row.
2. That column is **UNIQUE**, so concurrent requests collapse rather than race.
3. An already-`ISSUED` request **short-circuits before the HIS is contacted at all**.
4. A **partial unique index** refuses a second `ISSUED` row for the visit even if
   something bypassed all of the above.

MediKiosk never mints a token. It asks, and reports what came back.

## Uncertainty is not failure

The adapter distinguishes three outcomes, and the middle one is the whole design:

| Outcome     | Meaning                              | Response                                 |
| ----------- | ------------------------------------ | ---------------------------------------- |
| `ISSUED`    | The hospital gave us a token         | Store and display it                     |
| `REJECTED`  | The hospital understood and declined | `FAILED` — a retry is safe and pointless |
| `UNCERTAIN` | We do not know what happened         | Ask the hospital; park if it cannot say  |

Conflating "we do not know" with "it failed" is exactly how a patient ends up with two
tokens. A thrown adapter, a timeout, a truncated response — all `UNCERTAIN`, because the
request may well have reached the hospital before the connection died.

## Why an immediate `NOT_FOUND` is not believed

The first implementation polled the HIS after a timeout and, on `NOT_FOUND`, marked the
request `FAILED` so a retry could proceed. A test caught the problem.

A poll issued **milliseconds** after a timeout is racing the hospital's own commit.
`NOT_FOUND` then means _not yet_, not _never_ — and acting on it lets a retry overtake a
request that is about to succeed. A poll on a **later** attempt, after the first request
has definitively ended, can be believed.

So an immediate poll may only ever **recover** a token; it may never conclude there is
none. That costs a patient a walk to the counter in the rare uncertain case, which is the
right trade against handing someone a second hospital token.

## Reconciliation

`UNKNOWN_RECONCILIATION_REQUIRED` is terminal for the automated path. No number of kiosk
requests will move it, because moving it is precisely how a duplicate would be created.

`GET /v1/ops/reconciliation` lists parked requests; `POST /v1/ops/reconciliation/sweep`
re-polls the HIS about them. The sweep only ever _asks_ — it never requests a token — so
it is safe to run on a schedule and by hand.

Both sit behind `OpsGuard`, a shared-key placeholder that is **marked as one**: a shared
token cannot say who acted, which is what an audit trail needs, so nothing behind it reads
or alters clinical data. Phase 15 replaces it with staff SSO. With no key configured the
endpoints refuse rather than defaulting open.

## Handle rotation

Phase 6 spent the arrival handle on confirmation, because the flow ended there. It does
not — requesting a token is a third step. Rather than fall back to addressing the visit by
its pre-check-in id, which anyone who photographed the QR can read, the handle is now
**rotated** at each step: the value used to confirm cannot also fetch a token.

## Printing is never load-bearing

The token is the largest thing on screen, sized to be read at arm's length and
photographed. A printer failure is reported calmly beside a token that is still valid, and
never changes the token's state. A kiosk with no printer at all works normally.

## Test results

| Suite                                 | Count | Status  |
| ------------------------------------- | ----: | ------- |
| Backend unit                          |    89 | Passing |
| HIS adapter unit                      |     9 | Passing |
| Backend integration (real PostgreSQL) |   193 | Passing |
| Flutter widget and unit               |   179 | Passing |

Ten concurrent token requests produce exactly one token and exactly one row.

## A defect the walkthrough caught that the tests did not

The arrival flow drove the kiosk session through `IDENTITY_PENDING` → `IDENTITY_CONFIRMED`
and then five more states on token issue. Every integration test ran the arrival flow with
**no kiosk session open**, so this never fired. At a real kiosk there is always one — and
a mobile-QR patient's session sits in `CREATED`, because language, consent and
demographics all happened at home. `CREATED → IDENTITY_PENDING` is not a legal transition,
so the whole confirm step returned `INVALID_STATE_TRANSITION`.

The fix was not to add the edge. Those states describe the **kiosk-hosted** journey, and
marching a session through them would assert the kiosk captured a consent it never showed
— fiction in the audit trail. The session is now _linked_ to the visit as data, and the
visit's own state machine carries the journey. Tests now run the arrival flow with a live
session.

## Known limitations

- **No real HIS.** The sandbox is genuinely idempotent, because a sandbox that was not
  would hide the bug it should surface — but it is a counter in a Node process. A real
  integration is REST, FHIR R4 or HL7 v2 depending on the hospital, and
  `UnconfiguredHisAdapter` throws rather than pretending.
- **The ops guard is a placeholder**, and says so. Phase 15 brings staff SSO.
- **No reconciliation UI.** The endpoints exist; the governance/ops web app is Phase 14/16.
- **No sweep scheduler.** `sweepReconciliation` is implemented and tested but nothing runs
  it periodically — the job runner arrives in Phase 16.
- **"Send to mobile" is inert.** The button renders but does nothing; SMS delivery needs
  the gateway that Phase 5 also left unconfigured.
- **No printer implementation.** `TokenPrinter` is an interface with an honest unavailable
  default; the ESC/POS platform channel needs hardware to write against.

## Exit criteria

| Criterion                                  | Status                                                 |
| ------------------------------------------ | ------------------------------------------------------ |
| Final token comes from the HIS adapter     | Verified                                               |
| Duplicate-token tests pass                 | Verified — ten concurrent requests, one token, one row |
| HIS timeout is handled safely              | Verified — parked, never retried automatically         |
| Reconciliation dashboard exists            | Endpoints verified; the UI is Phase 16                 |
| Printer failure does not alter token state | Verified                                               |
| Token can be displayed without printing    | Verified — a kiosk with no printer works normally      |
