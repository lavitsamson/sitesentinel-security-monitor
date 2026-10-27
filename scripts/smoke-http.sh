# Shared by kind-smoke.sh and compose-smoke.sh (sourced, not run): the checks every
# deployment must pass through its front door, as a browser would. Each check is
# recorded and the caller decides at the end with smoke_finish.

BASE=${BASE_URL:-http://localhost:8080}
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

failures=0
# Records the outcome of the command that ran just before it.
check() {
  if [[ $? -eq 0 ]]; then
    echo "  ok    $1"
  else
    echo "  FAIL  $1" >&2
    failures=$((failures + 1))
  fi
}

smoke_http() {
  local jar
  jar=$(mktemp)

  echo "==> Web"
  curl -fsS "$BASE/" | grep -q '<div id="app">'
  check "app shell served at /"
  [[ $(status "$BASE/sites/does-not-exist") == 200 ]]
  check "client-side routes fall back to the app shell"
  curl -fsSI "$BASE/" | grep -qi '^content-security-policy:'
  check "web sends a Content-Security-Policy"

  echo "==> API"
  curl -fsS "$BASE/api/v1/health/ready" | grep -q '"status":"ok"'
  check "API ready (MongoDB and Redis reachable)"
  [[ $(status "$BASE/api/v1/metrics") == 401 ]]
  check "metrics require the bearer token"
  curl -fsS "$BASE/admin/queues" | grep -q '<div id="app">'
  check "Bull Board is not routed (the SPA answers /admin/queues)"
  curl -fsS -c "$jar" -o /dev/null \
    -H 'Content-Type: application/json' -H 'X-Requested-With: XMLHttpRequest' \
    -d '{"email":"demo@sitesentinel.demo","password":"DemoPass123!"}' \
    "$BASE/api/v1/auth/login"
  check "demo account signs in"
  curl -fsS -b "$jar" "$BASE/api/v1/sites?limit=100" | grep -q '"domain"'
  check "seeded demo sites are listed"

  rm -f "$jar"
}

smoke_finish() {
  if ((failures > 0)); then
    echo "$failures smoke check(s) failed." >&2
    exit 1
  fi
  echo "All smoke checks passed."
}
