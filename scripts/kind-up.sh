#!/usr/bin/env bash
# Creates a local kind cluster (or reuses it), builds and loads the images, deploys
# k8s/overlays/local and seeds the demo account. Safe to re-run after code changes.
#
# Needs: docker, kind, kubectl. See docs/DEPLOYMENT.md.
set -euo pipefail

cd "$(dirname "$0")/.."

CLUSTER=sitesentinel
NAMESPACE=sitesentinel
OVERLAY=k8s/overlays/local
kc() { kubectl --context "kind-$CLUSTER" "$@"; }

for tool in docker kind kubectl; do
  command -v "$tool" >/dev/null || { echo "error: $tool is not installed" >&2; exit 1; }
done

if kind get clusters | grep -qx "$CLUSTER"; then
  echo "==> Reusing kind cluster '$CLUSTER'"
else
  echo "==> Creating kind cluster '$CLUSTER'"
  kind create cluster --config k8s/kind/cluster.yaml --wait 120s
fi

echo "==> Installing add-ons (Traefik ingress controller, metrics-server)"
kc apply -k k8s/kind/addons
kc -n traefik rollout status deployment/traefik --timeout=180s
kc -n kube-system rollout status deployment/metrics-server --timeout=180s

echo "==> Building images"
for target in api worker web; do
  docker build --target "$target" -t "sitesentinel-$target:local" .
done
echo "==> Loading images into the cluster"
kind load docker-image --name "$CLUSTER" sitesentinel-api:local sitesentinel-worker:local sitesentinel-web:local

if [[ ! -f "$OVERLAY/secrets.env" ]]; then
  echo "==> Generating $OVERLAY/secrets.env (random, gitignored)"
  sed -e "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" \
      -e "s|^ALERT_SECRET_KEY=.*|ALERT_SECRET_KEY=$(openssl rand -base64 32 | tr -d '\n')|" \
      -e "s|^METRICS_TOKEN=.*|METRICS_TOKEN=$(openssl rand -hex 24)|" \
      "$OVERLAY/secrets.env.example" > "$OVERLAY/secrets.env"
fi

# The same image tag is reloaded on every run, so pods that already exist are
# restarted explicitly to pick up the new build.
existing=$(kc -n "$NAMESPACE" get deployment api worker web -o name --ignore-not-found 2>/dev/null || true)

echo "==> Deploying $OVERLAY"
# A Job's pod template is immutable; the finished seed Job is replaced on each run.
kc -n "$NAMESPACE" delete job seed --ignore-not-found
kc apply -k "$OVERLAY"
if [[ -n "$existing" ]]; then
  kc -n "$NAMESPACE" rollout restart deployment/api deployment/worker deployment/web
fi

for workload in statefulset/mongo statefulset/redis deployment/mailpit deployment/api deployment/worker deployment/web; do
  kc -n "$NAMESPACE" rollout status "$workload" --timeout=300s
done
kc -n "$NAMESPACE" wait --for=condition=complete job/seed --timeout=300s
kc -n "$NAMESPACE" logs job/seed

cat <<EOF

SiteSentinel is running on kind:
  App      http://localhost:8080  (demo@sitesentinel.demo / DemoPass123!)
  Mailpit  kubectl --context kind-$CLUSTER -n $NAMESPACE port-forward svc/mailpit 8025
  Pods     kubectl --context kind-$CLUSTER -n $NAMESPACE get pods,hpa
EOF
