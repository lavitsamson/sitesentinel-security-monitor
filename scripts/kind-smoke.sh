#!/usr/bin/env bash
# Smoke-tests a cluster deployed by kind-up.sh through the ingress, as a browser
# would, and checks that the network policies hold. Runs every check, then exits
# non-zero if any failed. Used by CI.
set -uo pipefail

CLUSTER=sitesentinel
NAMESPACE=sitesentinel
BASE=${BASE_URL:-http://localhost:8080}
kc() { kubectl --context "kind-$CLUSTER" -n "$NAMESPACE" "$@"; }
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

jar=$(mktemp)
trap 'rm -f "$jar"' EXIT

echo "==> Ingress and web"
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

echo "==> Worker"
kc wait --for=condition=available deployment/worker --timeout=60s >/dev/null
check "worker available (ready means MongoDB and Redis reachable)"
kc get hpa worker >/dev/null
check "worker autoscaler present"

echo "==> Network policies"
# Dropped packets show up as a timeout; a refusal or a response means they got through.
timed_out='(e) => process.exit(e.name === "TimeoutError" ? 0 : 1)'
# The Kubernetes API's ClusterIP is a private address, and 443 is an allowed port.
kc exec deployment/worker -- node -e "fetch('https://kubernetes.default.svc', { signal: AbortSignal.timeout(4000) }).then(() => process.exit(1), $timed_out)"
check "worker cannot reach private addresses, even on 443"
kc exec deployment/worker -- node -e "fetch('http://api:4000/api/v1/health/live', { signal: AbortSignal.timeout(4000) }).then(() => process.exit(1), $timed_out)"
check "worker cannot reach other pods on ports it does not need"

if ((failures > 0)); then
  echo "$failures smoke check(s) failed." >&2
  exit 1
fi
echo "All smoke checks passed."
