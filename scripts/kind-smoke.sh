#!/usr/bin/env bash
# Smoke-tests a cluster deployed by kind-up.sh through the ingress, as a browser
# would, and checks that the network policies hold. Runs every check, then exits
# non-zero if any failed. Used by CI.
set -uo pipefail

CLUSTER=sitesentinel
NAMESPACE=sitesentinel
kc() { kubectl --context "kind-$CLUSTER" -n "$NAMESPACE" "$@"; }

# shellcheck source=scripts/smoke-http.sh
source "$(dirname "$0")/smoke-http.sh"

smoke_http

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

smoke_finish
