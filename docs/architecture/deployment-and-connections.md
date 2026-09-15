# Where everything runs, and how the pieces find each other

Four clients, one backend, one database. This is the whole topology, for a laptop today and
for a hospital later.

## The shape

```
        KIOSK (Flutter, native)         PATIENT PWA (browser, patient's phone)
        Android tablet in the OPD       Next.js :3001
                    │                                │
                    │  HTTPS + X-Kiosk-Device        │  HTTPS
                    └───────────────┬────────────────┘
                                    │
                         ┌──────────▼───────────┐
                         │      core_api        │   NestJS, port 3000
                         │  the ONLY thing that │
                         │  touches the database│
                         └──────────┬───────────┘
                    ┌───────────────┼────────────────┐
                    │               │                │
            ┌───────▼──────┐  ┌─────▼──────┐  ┌──────▼──────┐
            │ PostgreSQL 16│  │   MinIO    │  │ HIS / SMS   │
            │ all records  │  │ documents  │  │  external   │
            └──────────────┘  └────────────┘  └─────────────┘
                                    ▲
                    ┌───────────────┴────────────────┐
        DOCTOR WEB (browser, :3002)        GOVERNANCE WEB (browser, :3003)
```

**No client ever talks to the database.** Not the kiosk, not the consoles. Every read and
write goes through `core_api`, which is where consent gates, state machines, audit and
redaction live. A console with its own database connection could bypass all of it, so none
has one — the connection string is not even shipped to them.

## Where the backend runs

`core_api` is a single Node process. It is stateless: sessions, rate limits and the job
queue all live in PostgreSQL, so you can run two of it behind a proxy and either can serve
any request.

| Where            | How                                                                           |
| ---------------- | ----------------------------------------------------------------------------- |
| Your laptop, now | `npm start` — Postgres, migrations, seed, API and all three consoles          |
| Hospital, later  | `infra/deployment/docker-compose.prod.yml` — two API nodes behind a TLS proxy |

The production compose file deliberately contains **no database and no object store**. The
specification asks for PostgreSQL with a standby or managed HA, and a Postgres container on
a local volume is neither — it is a single point of failure wearing a production label. The
same goes for MinIO. Both are the hospital's own infrastructure decision, and the file says
so in its header rather than leaving someone to discover it after go-live.

## Where the database is stored

**Today, on your Mac.** A local PostgreSQL instance, database `medikiosk_dev`, at
`postgres://localhost:5432/medikiosk_dev`. Data lives wherever your Postgres keeps it —
`postgres -D` will tell you, typically `/opt/homebrew/var/postgresql@16`. Nothing is in the
cloud and nothing leaves the machine.

There is a second database, `medikiosk_test`, which the integration suite truncates between
every test. Never point the app at it.

**In a hospital**, it belongs on hospital-controlled infrastructure inside the hospital
network. That is not a preference: this is patient health data under the DPDP Act, and
`docs/security/privacy-data-flow.md` traces what is collected on what basis. Managed
PostgreSQL from an Indian region, or a hospital-run primary with a standby, are both fine.
A database reachable from the public internet is not.

Documents are the exception to "it is all in PostgreSQL": the file bytes go to object
storage (MinIO, or S3-compatible), and the database keeps the object key, a SHA-256 taken
over the plaintext before encryption, and the metadata. A prescription photograph is large,
and a row is the wrong place for it.

## How each client connects

Every client is pointed at the API by **one environment variable**. There are no hard-coded
URLs anywhere — a CI check enforces that.

### Kiosk — native, compiled in

Baked in at build time, because a kiosk in a public corridor must not have a settings screen
someone can retarget:

```bash
flutter build apk --dart-define=MEDIKIOSK_API_BASE_URL=https://api.hospital.example
```

It identifies itself with `X-Kiosk-Device: MK-OPD-01`, the code printed on the enclosure.
`KioskDeviceGuard` resolves that to a registered, enabled device and refuses anything else.
**This is identification, not authentication** — the header is not a secret. Mutual-TLS
client certificates are the real control and are not built; `kiosk_device.cert_fingerprint`
exists and is unused. Until then, a stolen kiosk is disabled in the MDM and the guard takes
it out of service immediately.

Being native, the kiosk is not subject to CORS at all.

### The three web apps — runtime configuration

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.hospital.example
```

These are browsers, so they **are** subject to CORS, and the API allows no origin unless one
is configured:

```bash
CORS_ALLOWED_ORIGINS=https://patient.hospital.example,https://doctor.hospital.example
```

An allowlist, never a wildcard, and credentials are not enabled — these clients carry a
bearer token, not a cookie, so there is no cross-site request forgery surface to open.

This was missing for sixteen phases and nobody noticed, because until the consoles existed
the only client was native. Without it every console request is blocked in the browser
before it leaves: the API never sees it, logs nothing, and the console shows a generic
failure. If a console mysteriously cannot reach the API, check this first.

### Who each client authenticates as

| Client             | Identity                             | Status                                   |
| ------------------ | ------------------------------------ | ---------------------------------------- |
| Kiosk              | `X-Kiosk-Device` header              | Built. Certificates pending              |
| Patient PWA        | Mobile OTP, per session              | Built                                    |
| Doctor console     | Staff session, role-checked          | Built on a **sandbox** identity provider |
| Governance console | Staff session, `GOVERNANCE_REVIEWER` | Built on the same sandbox                |
| Prometheus / ops   | `Authorization: Bearer $OPS_API_KEY` | Built                                    |

Real staff SSO — the hospital's own directory — is not built. The sandbox provider is
clearly labelled and refuses to run in production.

## Running it today

```bash
npm start                      # the whole stack, with URLs printed when it is up
npm run journey                # walks a patient end to end and proves it works
bash scripts/probe-api.sh      # every route, fails on any 5xx
```

`npm run journey` is the honest answer to "is the kiosk fully functioning". It starts a
session, selects a language, grants consent, sends and verifies a one-time code, registers a
patient, opens a visit, answers the whole interview, reviews, submits, and collects a
hospital token — over HTTP, against the running system, exactly as the kiosk does. Fourteen
steps. It reads the code out of the API log, which only works because `SMS_ADAPTER=sandbox`;
against a real gateway it stops and says so rather than pretending.

## Going to a hospital: the order things must happen

1. **Clinical governance sign-off** — a practitioner authors and approves the consent notice
   and questionnaire, per language. Nothing else on this list matters until this is done,
   and no amount of engineering substitutes for it.
2. **Infrastructure** — PostgreSQL with a standby, object storage, TLS, a segmented VLAN.
3. **Integrations** — HIS or queue endpoint, SMS gateway with sender ID and DLT template,
   staff SSO.
4. **Devices** — Android Enterprise enrolment, lock-task provisioning, the kiosk built with
   the hospital's API URL, voices installed for the languages offered.
5. **Then** `tools/src/production-readiness.ts`, which will still return `ready: false` and
   name what remains.
