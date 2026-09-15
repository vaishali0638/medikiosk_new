#!/usr/bin/env bash
#
# Brings the whole MediKiosk stack up locally, in the order the pieces depend on each other,
# and waits for each to answer before starting the next.
#
# There is no hosted MediKiosk to link to and there should not be: the kiosk is a native
# Flutter app under lock-task mode, the API needs its own PostgreSQL, and the whole design
# assumes a hospital network. This is the closest honest equivalent — one command, one set
# of URLs, everything talking to everything.
#
# Ctrl-C stops every process this script started.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# One .env at the repository root, exported so the migrate and seed CLIs see it too —
# they are separate processes and read the environment, not the file.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  echo "using .env"
fi

DB_NAME="${MEDIKIOSK_DB:-medikiosk_dev}"
export DATABASE_URL="${DATABASE_URL:-postgres://localhost:5432/${DB_NAME}}"

PIDS=()
cleanup() {
  echo ""
  echo "stopping…"
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- database
say "1/5  PostgreSQL"
case "$DATABASE_URL" in
  *supabase.co*|*supabase.com*)
    echo "  hosted Supabase — not starting anything locally"
    npm run supabase:check || exit 1
    ;;
  *)
if ! psql -d "$DB_NAME" -c 'SELECT 1' >/dev/null 2>&1; then
  if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
    echo "  ${DB_NAME} unreachable — starting the Compose stack"
    npm run docker:up >/dev/null
    until psql -d "$DB_NAME" -c 'SELECT 1' >/dev/null 2>&1; do sleep 1; done
  else
    echo "  Cannot reach ${DB_NAME} and Docker is not running."
    echo "  Start PostgreSQL and run:  createdb ${DB_NAME}"
    exit 1
  fi
fi
echo "  ok — local ${DB_NAME}"
    ;;
esac

# ------------------------------------------------------------ schema + data
say "2/5  Migrations and seed"
npm run migrate -w @medikiosk/core-api 2>&1 \
  | grep -vE "Can't determine timestamp|^$" || true
npm run seed -w @medikiosk/core-api

# ------------------------------------------------------------------- the API
say "3/5  core_api on :3000"
npm run start:dev -w @medikiosk/core-api >/tmp/medikiosk-api.log 2>&1 &
PIDS+=($!)

# Poll rather than sleep: a fixed wait is either too short on a cold start or wasted time.
for _ in $(seq 1 60); do
  if curl -fsS http://localhost:3000/health >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! curl -fsS http://localhost:3000/health >/dev/null 2>&1; then
  echo "  core_api did not come up. Last lines of /tmp/medikiosk-api.log:"
  tail -20 /tmp/medikiosk-api.log
  exit 1
fi
echo "  ok"

# -------------------------------------------------------------- the web apps
say "4/5  Web consoles"
npm run dev -w @medikiosk/patient-pwa >/tmp/medikiosk-pwa.log 2>&1 &
PIDS+=($!)
npm run dev -w @medikiosk/doctor-web >/tmp/medikiosk-doctor.log 2>&1 &
PIDS+=($!)
npm run dev -w @medikiosk/governance-web >/tmp/medikiosk-governance.log 2>&1 &
PIDS+=($!)
echo "  starting (Next.js compiles on first request)"

# ----------------------------------------------------------------- summary
LANGS=$(curl -fsS -H 'X-Kiosk-Device: MK-OPD-01' \
  -H 'X-Correlation-Id: 11111111-1111-4111-8111-111111111111' \
  http://localhost:3000/v1/kiosk/config 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const l=JSON.parse(s).languages;console.log(l.length+" languages: "+l.map(x=>x.tag).join(" "))}catch{console.log("?")}})')

say "5/5  Ready"
cat <<EOF
  API              http://localhost:3000        (${LANGS})
  OpenAPI          http://localhost:3000/docs
  Patient PWA      http://localhost:3001
  Doctor console   http://localhost:3002
  Governance       http://localhost:3003

  Kiosk — in another terminal:
    cd apps/kiosk_flutter && flutter run -d macos \\
      --dart-define=MEDIKIOSK_API_BASE_URL=http://localhost:3000

  Logs: /tmp/medikiosk-{api,pwa,doctor,governance}.log
  Ctrl-C stops everything.
EOF

wait
