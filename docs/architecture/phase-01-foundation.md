# Phase 1 — Repository, design system and development foundation

## Objective

A stable monorepo with coding standards, a shared theme and a working development loop,
established _before_ any clinical behaviour is implemented.

## What was built

| Area                  | Detail                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Monorepo              | npm workspaces; packages, services, apps, infra, docs, tests, tools                                                   |
| TypeScript            | `strict`, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; project references for incremental builds |
| Lint/format           | ESLint 9 flat config + Prettier; `no-console` is an error so patient data cannot reach stdout                         |
| Design tokens         | `packages/design_tokens` is canonical; Dart and CSS are generated and diffed in CI                                    |
| Accessible components | `MkButton`, `MkScreen`, `AccessibilityScope` — 48 dp targets, large-text and high-contrast support, semantic headers  |
| Core API              | NestJS skeleton, zod-validated environment, correlation-id middleware, log redaction, `/health` and `/health/ready`   |
| Local stack           | Docker Compose: Postgres 16, Redis (AOF on), MinIO, core_api; non-root API container                                  |
| CI                    | Lint, typecheck, tests, Flutter analyze/test, forbidden-option scan, token-drift check, database reachability         |

## Decisions and trade-offs

**CommonJS across every TypeScript workspace.** NestJS depends on emitted decorator
metadata and is CommonJS-first. Mixing an ESM shared package with a CJS service costs more
in interop friction than the module format is worth here, so everything is CommonJS.

**Tokens generated, not duplicated.** The kiosk is Dart and the web surfaces are TypeScript.
Rather than maintain the palette twice, the TypeScript definition is canonical and the Dart
theme is generated. CI regenerates and diffs, so hand-editing the generated file fails the
build instead of silently drifting.

**Dependencies reported as `unconfigured`, not `ok`.** `/health/ready` returns `degraded`
with every dependency marked `unconfigured` while Phase 2 is outstanding. Reporting a stub
as healthy is exactly the failure mode the phase-control rules prohibit.

**Redaction is central, not per-call-site.** One careless log line is a reportable privacy
incident, so `redact()` masks identifiers and drops OTPs, signatures, nonces and narratives
regardless of who is logging.

**The Android host project is generated, not committed.** `flutter create` produces
`android/` deterministically; committing it by hand risks a subtly wrong Gradle setup that
would only surface during device lock-down work in Phase 3.

## Known limitations

- No database schema yet — `infra/migrations` is empty (Phase 2).
- `services/his_adapter` exports the safety invariant and adapter kinds only; no
  implementation (Phase 7).
- `apps/patient_pwa`, `apps/doctor_web`, `apps/governance_web`, `services/ai_worker` are
  documented placeholders with no code.
- The kiosk client has no `android/` directory until `flutter create` is run locally.
- `flutter analyze` and `flutter test` have **not been executed** — the Flutter SDK is not
  installed on the development machine used for this phase. The Dart code is written against
  Flutter 3.27+ (it uses the current `Color` component API) and is unverified until the SDK
  is available.
- Docker Compose has **not** been started end to end — the Docker daemon was not running and
  the Compose plugin is not installed on this machine. Both YAML files were parse-checked only.

## Verification

```bash
npm run verify
cd apps/kiosk_flutter && flutter analyze && flutter test
```
