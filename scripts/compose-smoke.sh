#!/usr/bin/env bash
# Smoke-tests the Docker Compose stack (`docker compose --profile app up`, then the
# seed) through the Caddy proxy on :8080, with the same front-door checks as the
# kind cluster. Runs every check, then exits non-zero if any failed. Used by CI.
set -uo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/smoke-http.sh
source scripts/smoke-http.sh

smoke_http

echo "==> Proxy"
! curl -fsSI "$BASE/" | grep -qiE '^(server|via):'
check "no Server or Via header reaches the browser"
! curl -fsSI "$BASE/" | grep -qi '^strict-transport-security:'
check "no HSTS over plain HTTP (sent only when Caddy terminates TLS)"

echo "==> Containers"
for service in api worker web proxy; do
  [[ $(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q "$service")") == healthy ]]
  check "$service healthy"
done
[[ $(docker inspect -f '{{.HostConfig.ReadonlyRootfs}} {{.Config.User}}' "$(docker compose ps -q api)") == 'true node' ]]
check "api runs as a non-root user on a read-only filesystem"
for service in api worker web; do
  [[ $(docker inspect -f '{{json .HostConfig.PortBindings}}' "$(docker compose ps -q "$service")") == '{}' ]]
  check "$service publishes no ports (reachable only through the proxy)"
done

smoke_finish
