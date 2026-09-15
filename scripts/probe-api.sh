#!/usr/bin/env bash
#
# Probes every mapped route against a running instance and prints the status.
#
# Written because "is every API working?" deserves an answer from the running system rather
# than from the route declarations, which say only that a handler was registered.
#
# Reading the output: a 4xx here is usually the route working. The probe sends an empty
# body and no credentials, so 400 means the payload was validated and 401 means the guard
# refused. A 404 means the route is not mounted; a 500 means it broke.

set -euo pipefail
BASE="${1:-http://localhost:3000}"
UUID=11111111-1111-4111-8111-111111111111

routes=$(curl -fsS "$BASE/docs-json" 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const p=JSON.parse(s).paths;
      for (const [path,ops] of Object.entries(p))
        for (const m of Object.keys(ops)) console.log(m.toUpperCase()+" "+path);
    })' | sort -u)

printf "%-7s %-52s %s\n" METHOD ROUTE STATUS
printf -- "------- ---------------------------------------------------- ------\n"
fail=0
while read -r method path; do
  # Substitute only {placeholders}. Replacing bare parameter names as substrings turned
  # /v1/identity/otp into /v1/<uuid>entity/otp, which 404s — and the first version of this
  # script duly reported five identity routes as missing when they were fine. A probe that
  # lies about the system is worse than no probe.
  probe=$(printf '%s' "$path" | sed -E "s/\{[A-Za-z]+\}/$UUID/g")
  args=(-s -o /dev/null -w '%{http_code}' -X "$method" --max-time 15
        -H 'Content-Type: application/json' -H "X-Kiosk-Device: MK-OPD-01"
        -H "X-Correlation-Id: $UUID")
  [ "$method" = POST ] && args+=(-d '{}')
  code=$(curl "${args[@]}" "$BASE$probe")
  printf "%-7s %-52s %s\n" "$method" "$path" "$code"
  case "$code" in 5*|000) fail=$((fail+1));; esac
done <<< "$routes"

echo ""
if [ "$fail" -gt 0 ]; then
  echo "$fail route(s) returned 5xx or did not answer."
  exit 1
fi
echo "No route returned 5xx."
