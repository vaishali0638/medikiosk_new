# Phase 2 — Database, contracts and state machines

## Objective

Create the authoritative domain model before building any screen that depends on it.

## What was built

| Area           | Detail                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| Migrations     | 6 SQL migrations, 21 tables, 21 enum types — run, reversed and re-run against PostgreSQL 16                   |
| State machines | Explicit transition tables for kiosk session, pre-check-in, token request and consent                         |
| Contracts      | Zod schemas in `@medikiosk/api-contracts`; enums shared by database, API and clients                          |
| OpenAPI        | `docs/api/openapi.json`, generated from the Zod schemas; 17 endpoints, all marked `x-status: not-implemented` |
| DB layer       | Kysely typed queries, SERIALIZABLE transaction helper with conflict-only retry                                |
| Repositories   | Consent, QR nonce, token request, audit — the transaction-critical records                                    |
| Seed           | One hospital, one branch, three departments, three languages, three kiosks; idempotent                        |
| Health         | `/health/ready` now performs a live database check and reports `ok`                                           |

## Test results

| Suite       | Count | Against               |
| ----------- | ----: | --------------------- |
| Unit        |    67 | —                     |
| Integration |    48 | Real PostgreSQL 16.15 |

Integration tests deliberately run against a real database. Atomic nonce consumption,
unique idempotency keys, serializable isolation and append-only rules are properties of
PostgreSQL itself; testing them against a mock or an in-memory emulation would prove nothing.

Concurrency properties actually exercised, not just reasoned about:

- Ten simultaneous scans of one QR — exactly one succeeds.
- Five simultaneous token requests — exactly one row is created.
- A second issued token, inserted directly and bypassing the repository — refused by the index.
- `UPDATE` and `DELETE` against `audit_event` — silently ineffective, verified by reading back.

## Three defects the tests caught

**`array_length()` never fired.** `consent.data_categories` was guarded by
`CHECK (array_length(data_categories, 1) >= 1)`. For an empty array `array_length` returns
NULL, `NULL >= 1` is NULL, and a CHECK treats NULL as passing — so a consent covering no
data categories at all would have been accepted. Now `cardinality()`, and the constraint is
explicitly named so the error says what it means.

**Enum arrays read back as strings.** `pg` keys its result parsers by OID and ships one for
every built-in array type, but a user-defined enum receives a dynamic OID at `CREATE TYPE`
time. Its array therefore had no parser, and `consent.data_categories` came back as the raw
literal `{demographics,clinical-history}` rather than an array. `registerEnumArrayParsers()`
resolves those OIDs at startup; tests call it too, so they exercise the real read path.

**Enum/table name collision.** A table implicitly creates a composite type of its own name,
so the enum `triage_status` and the table `triage_status` could not coexist. The enum is
now `triage_status_kind`.

## Decisions and trade-offs

**Constraints in the database, not the application.** Duplicate-token and QR-replay
prevention are expressed as unique indexes and conditional updates. An application-level
check-then-act races, and a race here means a patient gets a second hospital token or a
stolen QR works twice.

**SERIALIZABLE, with conflict-only retry.** Consent capture, arrival confirmation and token
transitions are read-modify-write sequences. `withSerializableRetry` retries on `40001` and
`40P01` only — a business-rule rejection is never retried, because that would be an attempt
to get a different answer to a question the database has already settled.

**Raw SQL migrations over an ORM schema.** A hospital DBA or security reviewer has to be
able to read the schema. Hand-written SQL is reviewable; a generated schema is not.
Kysely is used for queries because it is a typed query builder, not an ORM with its own
opinions about identity and lifecycle.

**Total transition tables.** `TransitionTable<S>` is `Record<S, readonly S[]>`, so adding a
state to the enum fails compilation until its outgoing edges are declared. There is no
implicit "anything can reach ERROR" escape hatch.

**Gating properties proved by graph cut, not by example.** Tests assert that deleting
`CONSENT_GRANTED` from the kiosk graph makes `INTAKE_IN_PROGRESS` unreachable from
`CREATED`. Asserting a few happy paths would not rule out some other edge quietly bypassing
the gate.

**Audit append-only via rules.** `DO INSTEAD NOTHING` makes tampering a silent no-op rather
than an error. That is the correct behaviour for an attacker but a trap for an honest bug,
so the tests verify by reading the row back rather than by expecting a throw.

## Known limitations

- **No endpoints.** Every operation in `openapi.json` is `x-status: not-implemented`.
  Repositories exist and are tested; the controllers that use them arrive in Phases 4–7.
- **No QR signing yet.** `qr_nonce` stores `signing_key_id`, but JWS signing and
  verification are Phase 6.
- **No HIS adapter.** `token_request` models the lifecycle; nothing calls a hospital.
- **The consent notice is a placeholder.** The seeded governance version says so explicitly
  and requires hospital legal and clinical approval before pilot use.
- **Kysely types are hand-written.** Enum parity with the database is tested; column-level
  parity is not. A column rename would be caught by `tsc`, but a type change might not.
- **Docker Compose still unexercised** — the daemon is not running on this machine and the
  Compose plugin is absent. Migrations and tests were run against a local PostgreSQL 16.15
  instead, which is a stronger check than Compose would have been.
- **`node-pg-migrate` warns** `Can't determine timestamp for 0005`. Filenames use numeric
  prefixes rather than timestamps; ordering is deterministic and lexicographic. Cosmetic.

## Verification

```bash
createdb medikiosk_dev && createdb medikiosk_test
export DATABASE_URL=postgres://localhost:5432/medikiosk_dev

npm run migrate      -w @medikiosk/core-api   # from empty
npm run migrate      -w @medikiosk/core-api   # idempotent
npm run migrate:redo -w @medikiosk/core-api   # reverses and re-applies
npm run seed         -w @medikiosk/core-api

DATABASE_URL=postgres://localhost:5432/medikiosk_test \
  npm run migrate:reset -w @medikiosk/core-api && \
  npm run test:int -w @medikiosk/core-api

npm run verify
```

## Exit criteria

| Criterion                                              | Status                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Migrations run from an empty database                  | Verified                                                                             |
| Migrations run repeatedly without corruption           | Verified — re-run is a no-op; down 6 then up rebuilds all 21 tables                  |
| State transitions reject invalid transitions           | Verified — every undeclared ordered pair throws, exhaustively, for all four machines |
| Consent, QR and token records are transactionally safe | Verified under real concurrency                                                      |
| API contracts are versioned                            | `API_CONTRACT_VERSION = 1.0.0-alpha.1`, asserted by the health endpoint              |
