# Deployment

SiteSentinel ships as three container images built from one [`Dockerfile`](../Dockerfile), deployed to Kubernetes with kustomize. Why the worker tier scales on its own is in [ADR 0008](adr/0008-kubernetes-and-worker-scaling.md).

## Images

| Image                 | Target   | Contents                                                        | Runs as       | Port                |
| --------------------- | -------- | --------------------------------------------------------------- | ------------- | ------------------- |
| `sitesentinel-api`    | `api`    | `node dist/main.js` with production dependencies only           | `node` (1000) | 4000                |
| `sitesentinel-worker` | `worker` | `node dist/main.js` with production dependencies only           | `node` (1000) | 9464 (metrics only) |
| `sitesentinel-web`    | `web`    | the built SPA on nginx-unprivileged, with CSP and cache headers | `nginx` (101) | 8080                |

```bash
docker build --target api    -t sitesentinel-api .
docker build --target worker -t sitesentinel-worker .
docker build --target web    -t sitesentinel-web .
```

One shared build stage installs from the lockfile (`--frozen-lockfile`, same supply-chain policy as local installs), builds every package, then `pnpm deploy --prod` copies each Node app with only its runtime dependencies. Base images are pinned by digest. App files are owned by root, so the app user can't modify them, and Node runs as PID 1, where `main.ts` handles SIGTERM for graceful shutdown. `APP_VERSION` (build arg, default `0.1.0`) is reported in the outbound `User-Agent`.

## Kubernetes layout

```
k8s/
├── base/                    # the three apps, environment-independent
│   ├── namespace.yaml       # Pod Security "restricted" enforced
│   ├── config.env           # non-secret settings → ConfigMap (content-hashed)
│   ├── api.yaml             # Deployment (2 replicas), Service, PodDisruptionBudget
│   ├── worker.yaml          # Deployment, headless metrics Service, HorizontalPodAutoscaler
│   ├── web.yaml             # Deployment (2 replicas), Service, PodDisruptionBudget
│   ├── ingress.yaml         # /api → api, / → web
│   └── network-policies.yaml
├── overlays/local/          # kind: in-cluster MongoDB/Redis/Mailpit, seed Job, local images
└── kind/
    ├── cluster.yaml         # one node, pinned image, localhost:8080 → ingress
    └── addons/              # Traefik ingress controller, metrics-server
```

### What every app pod gets

| Concern   | Setting                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Probes    | startup + liveness on the live endpoint (no dependency checks); readiness on the ready endpoint (MongoDB and Redis); web uses nginx `/healthz` |
| Resources | requests and limits on every container; the HPA targets 70% of the worker's CPU request                                                        |
| Security  | non-root, read-only root filesystem (an `emptyDir` for `/tmp`), all capabilities dropped, RuntimeDefault seccomp, no service-account token     |
| Secrets   | only the keys each process uses, from the `sitesentinel-secrets` Secret (the worker never receives `JWT_ACCESS_SECRET`)                        |
| Rollouts  | `maxUnavailable: 0`; API and web sleep 5 s in `preStop` so endpoint removal propagates before shutdown; the worker gets 45 s to drain its jobs |
| Placement | spread across nodes (`topologySpreadConstraints`, best effort)                                                                                 |

| Endpoint          | api                    | worker (port 9464) | web        |
| ----------------- | ---------------------- | ------------------ | ---------- |
| Startup, liveness | `/api/v1/health/live`  | `/health/live`     | `/healthz` |
| Readiness         | `/api/v1/health/ready` | `/health/ready`    | `/healthz` |
| Metrics           | `/api/v1/metrics`      | `/metrics`         | n/a        |

### Network policies

All pods start from default deny (ingress and egress), then:

| Policy                    | Allows                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `allow-dns`               | every pod → kube-dns on 53                                                                                |
| `allow-http-ingress`      | anything → api:4000, web:8080 (the ingress controller)                                                    |
| `allow-worker-metrics`    | anything → worker:9464 (Prometheus; `/metrics` needs the token)                                           |
| `allow-datastore-egress`  | api, worker, seed → TCP 27017, 6379, 25/465/587, 1025                                                     |
| `allow-public-web-egress` | api, worker → **public** IPv4/IPv6 on 80/443; private, loopback, link-local, CGNAT and multicast excluded |

The local overlay adds ingress rules so MongoDB, Redis and Mailpit accept connections only from the pods that use them. The egress rule mirrors the SSRF guard ([ADR 0002](adr/0002-ssrf-protection.md)) at the network layer. It needs a CNI that enforces NetworkPolicy; kind's default does.

## Local cluster (kind)

Prerequisites: Docker, [kind](https://kind.sigs.k8s.io/) v0.33+, kubectl, bash and openssl (Git Bash works on Windows).

```bash
make kind-up      # or: bash scripts/kind-up.sh
make kind-smoke   # or: bash scripts/kind-smoke.sh
make kind-down    # deletes the cluster and its volumes
```

`kind-up` is idempotent; re-run it after a code change. It:

1. creates the `sitesentinel` cluster from `k8s/kind/cluster.yaml` (or reuses it);
2. installs Traefik and metrics-server (`k8s/kind/addons`);
3. builds the three images and loads them into the node (`kind load docker-image`, never pulled);
4. writes `k8s/overlays/local/secrets.env` with random values on first run (gitignored; keys in `secrets.env.example`);
5. applies `k8s/overlays/local`, restarts the apps if they were already running, waits for every rollout, and runs the seed Job (the same demo data as `pnpm seed`).

Then open http://localhost:8080 and sign in as `demo@sitesentinel.demo` / `DemoPass123!`. Demo sites are checked passively once a day, from inside the cluster.

| To…                         | Run                                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| see pods and the autoscaler | `kubectl --context kind-sitesentinel -n sitesentinel get pods,hpa`                                                                                        |
| read emails (Mailpit)       | `kubectl --context kind-sitesentinel -n sitesentinel port-forward svc/mailpit 8025`, then http://localhost:8025                                           |
| follow worker logs          | `kubectl --context kind-sitesentinel -n sitesentinel logs -f deploy/worker`                                                                               |
| scrape worker metrics       | `kubectl ... port-forward svc/worker-metrics 9464`, then `curl -H "Authorization: Bearer $METRICS_TOKEN" localhost:9464/metrics` (token in `secrets.env`) |

`kind-smoke` checks, through the ingress: the app shell and SPA fallback, the CSP header, API readiness, that metrics need the token, that Bull Board isn't routed, demo sign-in and the seeded sites. It also checks worker readiness and the HPA, and runs `fetch` from inside a worker pod to prove the egress policy drops private addresses (the Kubernetes API on 443) and ports it doesn't need. CI runs `kind-up` and `kind-smoke` on every push.

## Production

The base is production-shaped; a production overlay supplies what differs:

| Setting    | How                                                                                                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Images     | `images:` with a release tag or digest (`ghcr.io/lavitsamson/sitesentinel-*` in the base)                                                                                                                                          |
| Secrets    | a `sitesentinel-secrets` Secret with `MONGO_URL`, `REDIS_URL`, `SMTP_URL`, `JWT_ACCESS_SECRET`, `ALERT_SECRET_KEY`, `METRICS_TOKEN`, ideally synced from a secret manager (External Secrets, Sealed Secrets) rather than committed |
| Datastores | managed MongoDB and Redis (Redis with `maxmemory-policy noeviction` and persistence, as BullMQ requires); a real SMTP relay                                                                                                        |
| Ingress    | `ingressClassName`, `host`, and TLS (e.g. cert-manager); add HSTS at the controller                                                                                                                                                |
| Config     | `WEB_ORIGIN` (CORS and email links) and `MAIL_FROM` via a `configMapGenerator` merge; `TRUST_PROXY` = number of proxies in front of the API (1 behind the ingress controller)                                                      |
| Scaling    | API `replicas`; worker HPA `minReplicas`/`maxReplicas` and `WORKER_CONCURRENCY`                                                                                                                                                    |
| Network    | narrow `allow-http-ingress` to the ingress controller's namespace once the controller is known; if DNS goes through NodeLocal DNSCache, allow its address                                                                          |

Not in the cluster on purpose: Bull Board (off in production; reach it with `kubectl port-forward` and `BULL_BOARD_ENABLED=true` on a one-off API pod if needed) and the `SIMULATED_NETWORK` flag (refused when `NODE_ENV=production`).

Milestone 10 covers the production deployment itself.
