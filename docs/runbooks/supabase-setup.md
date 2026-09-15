# Running MediKiosk on Supabase

Supabase gives the MVP a hosted PostgreSQL, an object store and — later — staff auth,
without anyone running a database. Twenty minutes of setup, and one command that tells you
whether it worked.

## What Supabase is and is not, here

**It is the infrastructure underneath `core_api`.** Hosted Postgres instead of the one on
your laptop, Supabase Storage instead of MinIO.

**It is not the backend.** No client — not the kiosk, not the consoles, not the PWA — gets
a Supabase key or talks to PostgREST. Every consent gate, state machine, audit rule,
rate limit and redaction lives in `core_api`, and a client with a database connection
bypasses all of them. The `anon` key exists to let browsers hit the database directly;
that is exactly what must not happen with patient health data under these rules.

So: `SUPABASE_SERVICE_ROLE_KEY` is held by `core_api` and nothing else. It bypasses
row-level security by design. If it reaches a browser or a kiosk build, rotate it.

## Setup

**1. Create a project.** Choose the Mumbai (`ap-south-1`) region — patient health data
under the DPDP Act should not leave India without a reason you can defend. Save the
database password; it appears once.

**2. Create the storage bucket.** Storage → New bucket → `medikiosk-documents` → **Private**.
The server refuses to start against a public bucket, but do not rely on that: set it
private now.

**3. Collect four values.** Project Settings → Database, and → API:

|                          | Where                              |
| ------------------------ | ---------------------------------- |
| Direct connection string | Database → Connection string → URI |
| Project URL              | API → Project URL                  |
| Service role key         | API → `service_role` (**secret**)  |
| Bucket name              | what you called it above           |

**4. Configure.** Copy `infra/deployment/.env.supabase.example` to `.env` and fill it in.

**5. Migrate, seed, check.**

```bash
export $(grep -v '^#' .env | xargs)
npm run migrate -w @medikiosk/core-api
npm run seed    -w @medikiosk/core-api
npm run supabase:check
```

`supabase:check` verifies the connection is direct rather than pooled, that TLS is
actually on, the PostgreSQL version, that the schema is applied, the connection budget, and
that the bucket exists and is private. Every check corresponds to a specific way this
fails in practice. It exits non-zero if anything is wrong.

**6. Run.**

```bash
npm start
npm run journey       # walks a patient end to end against it
```

## The two connection strings, and why it matters

Supabase offers three ways in, and they are not interchangeable.

| Port                        | What             | Use for                                   |
| --------------------------- | ---------------- | ----------------------------------------- |
| `db.<ref>.supabase.co:5432` | Direct           | **Migrations.** Always                    |
| Pooler `:5432`              | Session mode     | The API, if direct connections are scarce |
| Pooler `:6543`              | Transaction mode | The API under load                        |

Migrations take advisory locks and run DDL across several statements. The transaction
pooler hands a different backend connection to each statement, so a migration run through
`:6543` fails in a way that reads like a permissions problem and is not.
`supabase:check` refuses `:6543` for this reason.

The API itself is fine on any of the three. It uses unnamed prepared statements, which
Supavisor handles, and its SERIALIZABLE transactions are each a single unit of work.

Watch `DB_MAX_CONNECTIONS`. Smaller Supabase plans allow few direct connections, and two API
nodes at ten each will exhaust them; `supabase:check` prints the budget.

## What Supabase does not solve

- **The clinical content.** Still placeholders. Still the thing that blocks a pilot.
- **SMS.** Supabase does not send it. `SMS_ADAPTER=http` with an Indian gateway.
- **Staff SSO.** Supabase Auth could replace the sandbox provider; not wired up.
- **Backups.** Supabase takes them on paid plans. Free tier does not.
  `docs/runbooks/backup-and-restore.md` assumes you have them.
- **Encryption of documents.** Already handled above the storage layer — Supabase holds
  ciphertext, and the key never leaves `core_api`. That is deliberate: a managed provider's
  administrator should not be able to read a patient's prescription.

## Moving off it later

Nothing is Supabase-specific except two environment variables. The database is plain
PostgreSQL 16 with raw SQL migrations; `pg_dump` and restore anywhere. Documents are
encrypted envelopes behind the `ObjectStore` interface — a new transport is one class, as
`SupabaseObjectStore` was. There is no vendor SDK in the dependency tree.
