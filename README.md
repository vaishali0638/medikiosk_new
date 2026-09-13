# MediKiosk

Patient-intake kiosk platform for Indian hospital OPDs, starting with government AYUSH
hospitals. Patients complete language selection, consent, identification, clinical intake and
document upload at a locked-down kiosk (or ahead of time on their phone), and the **hospital
HIS/queue** — never MediKiosk — issues the final token.

> **Not production ready.** This repository is at Phase 1 of an 18-phase build. See
> [Build status](#build-status).

## What this is not

MediKiosk is an intake and documentation-support system. It does not diagnose, does not
prescribe, does not select an AYUSH remedy, and does not modify a verified clinical record.
Every piece of derived information carries a provenance label, and a clinician must confirm
anything before it reaches the EMR.

- Patient-facing label: **Your information for the doctor**
- Doctor-facing label: **AI-assisted pre-consultation draft — not verified**

## Repository layout

```
apps/kiosk_flutter     Flutter kiosk client (Android 12+, lock-task mode)
apps/patient_pwa       Patient pre-check-in PWA (Next.js)
apps/doctor_web        Clinician dashboard (Next.js, :3002)
apps/governance_web    Clinical governance console (Next.js, :3003)
services/core_api      NestJS modular monolith
services/his_adapter   HIS/queue adapter interface + sandbox
services/ai_worker     Python ASR/OCR/summary workers      [placeholder — Phase 10/11]
packages/api_contracts        Shared typed contracts
packages/design_tokens        Canonical theme (generates Dart + CSS)
packages/questionnaire_schema Questionnaire schema, branching language and engine
packages/terminology          Provenance labels and value sets
infra/docker           Local development stack
infra/migrations       PostgreSQL migrations (14 files, 23 tables)
infra/seed-content     Placeholder governed content (consent notices)
tools                  Repository guards (forbidden-option scan)
docs                   Architecture, API, security, runbooks
tests                  Contract, integration and end-to-end journeys
```

## Local setup

Requires Node 22+ (see `.nvmrc`), Docker, and Flutter 3.27+ for the kiosk client.

```bash
npm install
cp infra/docker/.env.example infra/docker/.env   # then edit the placeholder passwords
npm run docker:up                                 # Postgres 16, Redis, MinIO, core_api
curl http://localhost:3000/health/ready
```

Against a local PostgreSQL instead of Compose:

```bash
createdb medikiosk_dev
export DATABASE_URL=postgres://localhost:5432/medikiosk_dev
npm run migrate -w @medikiosk/core-api
npm run seed    -w @medikiosk/core-api
npm run start:dev -w @medikiosk/core-api
```

Kiosk client (Flutter 3.27+):

```bash
cd apps/kiosk_flutter
flutter pub get && flutter analyze && flutter test
```

## Checks

```bash
npm run verify          # format, lint, typecheck, forbidden-option scan, unit tests
npm run scan:forbidden  # banned kiosk options, on its own
npm run tokens:build    # regenerate the Dart and CSS themes from the TS tokens
npm run build -w @medikiosk/api-contracts   # regenerate docs/api/openapi.json

createdb medikiosk_test
DATABASE_URL=postgres://localhost:5432/medikiosk_test \
  npm run migrate:reset -w @medikiosk/core-api && npm run test:int -w @medikiosk/core-api
```

`npm run verify` covers neither the Flutter client nor the integration tests — run
`flutter analyze && flutter test` and `npm run test:int` separately, as CI does.

## Data model

21 tables, 21 enum types. See [docs/architecture/data-model.md](docs/architecture/data-model.md)
for the ERD and the constraints that carry safety properties — one issued token per visit,
one live QR per visit, an append-only audit trail.

## Design tokens

`packages/design_tokens/src/tokens.ts` is the single source of truth for the theme.
`apps/kiosk_flutter/lib/theme/design_tokens.dart` and `packages/design_tokens/dist/tokens.css`
are **generated**; CI fails if they drift. Colour roles are a safety rule, not a style
preference:

| Colour                     | Role                                                                     |
| -------------------------- | ------------------------------------------------------------------------ |
| Blue `#1565C0` / `#0D47A1` | Navigation and information                                               |
| Orange `#F57C00`           | The single primary action per screen, and selected states                |
| Red `#C62828`              | Internal/system alert status only — **never** a patient-facing diagnosis |

## Forbidden kiosk options

These strings are banned from patient-facing UI and enforced by `npm run scan:forbidden` in
CI. Each one either routes around hospital authority or advertises a support channel the
deployment does not provide:

`Staff Help` · `Get Staff Help` · `Urgent Help` · `I need urgent help` · `Generate New QR` ·
`Enter hospital reference` · `Register without phone` · `Enter token` · `Approved ABHA Flow`

## Build status

| Phase  | Scope                                                         | Status                                          |
| ------ | ------------------------------------------------------------- | ----------------------------------------------- |
| 0      | Discovery, clinical governance, hospital sign-off             | Not started — organisational                    |
| 1      | Repo, design system, CI, health check                         | Complete                                        |
| 2      | Database, contracts, state machines                           | Complete                                        |
| 3      | Kiosk shell and session security                              | Complete                                        |
| 4      | Language, accessibility, consent                              | Complete                                        |
| 5      | Identity and patient matching                                 | Complete                                        |
| 6      | Mobile pre-check-in and signed QR                             | Complete                                        |
| 7      | HIS/queue token adapter                                       | Complete                                        |
| 8      | New registration and common clinical core                     | Complete — content is an unapproved placeholder |
| 9      | AYUSH modules                                                 | Engine complete — no approved module exists     |
| 10     | Documents and OCR                                             | Pipeline complete — no OCR engine ships         |
| **11** | **Patient review and safe AI draft**                          | **Gate complete** — no generator ships          |
| 12–18  | Follow-up, doctor, governance, hardening, ops, pilot, release | Next: 12 — follow-up delta                      |

Every unbuilt capability is behind a feature flag that defaults to off, and a disabled
feature must not appear in any UI.

## Licence

UNLICENSED — internal project.
